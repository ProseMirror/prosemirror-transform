import {Fragment, Slice} from "prosemirror-model"

import {ReplaceStep, ReplaceAroundStep} from "./replace_step"
import {Transform} from "./transform"
import {insertPoint} from "./structure"

// :: (Node, number, ?number, ?Slice) → ?Step
// ‘Fit’ a slice into a given position in the document, producing a
// [step](#transform.Step) that inserts it. Will return null if
// there's no meaningful way to insert the slice here, or inserting it
// would be a no-op (an empty slice over an empty range).
export function replaceStep(doc, from, to = from, slice = Slice.empty) {
  if (from == to && !slice.size) return null

  let $from = doc.resolve(from), $to = doc.resolve(to)
  // Optimization -- avoid work if it's obvious that it's not needed.
  if (fitsTrivially($from, $to, slice)) return new ReplaceStep(from, to, slice)

  let fit = new Fitter($from, $to, slice).fit()
  if (!fit) return null
  return fit.size || from != to ? new ReplaceStep(from, to, fit) : null
}

// :: (number, ?number, ?Slice) → this
// Replace the part of the document between `from` and `to` with the
// given `slice`.
Transform.prototype.replace = function(from, to = from, slice = Slice.empty) {
  let step = replaceStep(this.doc, from, to, slice)
  if (step) this.step(step)
  return this
}

// :: (number, number, union<Fragment, Node, [Node]>) → this
// Replace the given range with the given content, which may be a
// fragment, node, or array of nodes.
Transform.prototype.replaceWith = function(from, to, content) {
  return this.replace(from, to, new Slice(Fragment.from(content), 0, 0))
}

// :: (number, number) → this
// Delete the content between the given positions.
Transform.prototype.delete = function(from, to) {
  return this.replace(from, to, Slice.empty)
}

// :: (number, union<Fragment, Node, [Node]>) → this
// Insert the given content at the given position.
Transform.prototype.insert = function(pos, content) {
  return this.replaceWith(pos, pos, content)
}

function fitsTrivially($from, $to, slice) {
  return !slice.openStart && !slice.openEnd && $from.start() == $to.start() &&
    $from.parent.canReplace($from.index(), $to.index(), slice.content)
}

class Fitter {
  constructor($from, $to, slice) {
    this.$to = $to
    this.$from = $from
    this.unplaced = slice

    this.frontier = []
    for (let i = 0; i <= $from.depth; i++) {
      let node = $from.node(i)
      this.frontier.push({
        type: node.type,
        attrs: node.attrs,
        match: node.contentMatchAt($from.indexAfter(i))
      })
    }

    this.placed = Fragment.empty
    for (let i = $from.depth; i > 0; i--)
      this.placed = Fragment.from($from.node(i).copy(this.placed))
  }

  fit() {
    while (this.unplaced.size) {
      let fit = this.findFittable()
      if (fit) this.placeNodes(fit)
      else this.openMore() || this.dropNodes(this.unplaced.openStart)
    }
    if (this.close()) {
      let content = this.placed, openStart = this.$from.depth, openEnd = this.$to.depth
      while (openStart && openEnd && content.childCount == 1) {
        content = content.firstChild.content
        openStart--; openEnd--
      }
      return new Slice(content, openStart, openEnd)
    }
  }

  findFittable() {
    for (let pass = 0; pass < 2; pass++) {
      for (let sliceDepth = this.unplaced.openStart; sliceDepth >= 0; sliceDepth--) {
        let fragment = contentAt(this.unplaced.content, sliceDepth)
        let first = fragment.firstChild, parent = !first && contentAt(this.unplaced.content, sliceDepth - 1).firstChild.type
        for (let frontierDepth = this.frontier.length - 1; frontierDepth >= 0; frontierDepth--) {
          let {type, match} = this.frontier[frontierDepth], wrap
          if (pass == 0 && (first ? match.matchType(first.type) : type.compatibleContent(parent)))
            return {sliceDepth, frontierDepth}
          else if (pass == 1 && first && (wrap = match.findWrapping(first.type)))
            return {sliceDepth, frontierDepth, wrap}
        }
      }
    }
  }

  openMore() {
    let inner = contentAt(this.unplaced.content, this.unplaced.openStart)
    if (!inner.childCount || inner.firstChild.isLeaf) return false
    this.unplaced = new Slice(this.unplaced.content, this.unplaced.openStart + 1, this.unplaced.openEnd)
    return true
  }

  dropNodes(depth, count = 1) {
    let {content, openEnd} = this.unplaced
    while (depth >= 0 && contentAt(content, depth).childCount <= count) {
      depth--
      count = 1
    }
    if (depth < 0) {
      this.unplaced = Slice.empty
    } else {
      content = dropFromFragment(content, depth, count)
      this.unplaced = new Slice(content, depth, openAcrossTo(this.unplaced, depth) ? depth : openEnd)
    }
  }

  // : ({sliceDepth: number, frontierDepth: number, wrap: ?[NodeType]})
  placeNodes({sliceDepth, frontierDepth, wrap}) {
    while (this.frontier.length - 1 > frontierDepth) this.closeFrontierNode()
    if (wrap) for (let i = 0; i < wrap.length; i++) this.openFrontierNode(wrap[i])

    let fragment = contentAt(this.unplaced.content, sliceDepth)
    let openStart = this.unplaced.openStart - sliceDepth, openEnd = this.unplaced.openEnd - sliceDepth
    let taken = 0, add = []
    let {match, type} = this.frontier[frontierDepth]
    while (taken < fragment.childCount) {
      let next = fragment.child(taken), matches = match.matchType(next.type)
      if (!matches) break
      taken++
      match = matches
      add.push(closeNode(next.mark(type.allowedMarks(next.marks)),
                         taken == 1 ? openStart : 0, taken == fragment.childCount ? openEnd : 0))
    }
    let openAtEnd = openAcrossTo(this.unplaced, sliceDepth)
    this.frontier[frontierDepth].match = match
    if (openAtEnd) {
      for (let d = sliceDepth, node = fragment.lastChild; d <= this.unplaced.openEnd; d++)
        this.frontier.push({type: node.type, attrs: node.attrs, match: node.contentMatchAt(node.childCount)})
    } else {
      this.closeFrontierNode()
    }
    this.dropNodes(sliceDepth, taken)
    this.placed = addToFragment(this.placed, frontierDepth, Fragment.from(add))
  }

  // FIXME remove
  toString() { return this.placed + " before " + this.frontier.map(f => f.type.name) + " remaining " + this.unplaced }

  findCloseLevel() {
    scan: for (let i = Math.min(this.frontier.length - 1, this.$to.depth); i >= 0; i--) {
      let {content} = this.$to.node(i), index = this.$to.index(i)
      let fit = this.frontier[i].match.fillBefore(content, true, index)
      if (!fit || invalidMarks(this.frontier[i].type, content, index)) continue
      for (let d = i - 1; d >= 0; d--) {
        let {content} = this.$to.node(d), index = this.$to.indexAfter(d)
        let here = this.frontier[d].match.fillBefore(content, true, index)
        if (!here || here.childCount || invalidMarks(this.frontier[d].type, content, index)) continue scan
      }
      return {depth: i, fit}
    }
  }

  close() {
    let close = this.findCloseLevel()
    if (!close) return false

    while (this.frontier.length - 1 > close.depth) this.closeFrontierNode()
    if (close.fit.childCount) this.placed = addToFragment(this.placed, close.depth, close.fit)
    for (let d = close.depth + 1; d <= this.$to.depth; d++) {
      let node = this.$to.node(d), add = node.type.contentMatch.fillBefore(node.content, true, this.$to.index(d))
      this.openFrontierNode(node.type, add)
    }
    return true
  }

  openFrontierNode(type, content) {
    let top = this.frontier[this.frontier.length - 1]
    top.match = top.match.matchType(type)
    this.placed = addToFragment(this.placed, this.frontier.length - 1, Fragment.from(type.create(null, content)))
    this.frontier.push({type, attrs: null, match: type.contentMatch})
  }

  closeFrontierNode() {
    let open = this.frontier.pop()
    let add = open.match.fillBefore(Fragment.empty, true)
    if (add.childCount) this.placed = addToFragment(this.placed, this.frontier.length, add)
  }
}

function dropFromFragment(fragment, depth, count) {
  if (depth == 0) return fragment.cutByIndex(count)
  return fragment.replaceChild(0, fragment.firstChild.copy(dropFromFragment(fragment.firstChild.content, depth - 1, count)))
}

function addToFragment(fragment, depth, content) {
  if (depth == 0) return fragment.append(content)
  return fragment.replaceChild(fragment.childCount - 1,
                               fragment.lastChild.copy(addToFragment(fragment.lastChild.content, depth - 1, content)))
}

function contentAt(fragment, depth) {
  for (let i = 0; i < depth; i++) fragment = fragment.firstChild.content
  return fragment
}

function closeNode(node, openStart, openEnd) {
  if (openStart <= 0 && openEnd <= 0) return node
  let frag = node.content
  if (openStart > 1 || frag.childCount == 1 && openEnd > 1)
    frag = frag.replaceChild(0, closeNode(frag.firstChild, openStart - 1, frag.childCount == 1 ? openEnd - 1: 0))
  if (openEnd > 1 && frag.childCount > 1)
    frag = frag.replaceChild(frag.childCount - 1, closeNode(frag.lastChild, 0, openEnd - 1))
  if (openStart > 0)
    frag = node.type.contentMatch.fillBefore(frag, false).append(frag)
  if (openEnd > 0)
    frag = frag.append(node.type.contentMatch.matchFragment(frag).fillBefore(Fragment.empty, true))
  return node.copy(frag)
}

function openAcrossTo(slice, depth) {
  if (slice.openEnd < depth) return false
  for (let d = 0, content = slice.content; d < depth; d++) {
    if (content.childCount != 1) return false
    content = content.firstChild.content
  }
  return true
}

function invalidMarks(type, fragment, start) {
  for (let i = start; i < fragment.childCount; i++)
    if (!type.allowsMarks(fragment.child(i).marks)) return true
  return false
}

// :: (number, number, Slice) → this
// Replace a range of the document with a given slice, using `from`,
// `to`, and the slice's [`openStart`](#model.Slice.openStart) property
// as hints, rather than fixed start and end points. This method may
// grow the replaced area or close open nodes in the slice in order to
// get a fit that is more in line with WYSIWYG expectations, by
// dropping fully covered parent nodes of the replaced region when
// they are marked [non-defining](#model.NodeSpec.defining), or
// including an open parent node from the slice that _is_ marked as
// [defining](#model.NodeSpec.defining).
//
// This is the method, for example, to handle paste. The similar
// [`replace`](#transform.Transform.replace) method is a more
// primitive tool which will _not_ move the start and end of its given
// range, and is useful in situations where you need more precise
// control over what happens.
Transform.prototype.replaceRange = function(from, to, slice) {
  if (!slice.size) return this.deleteRange(from, to)

  let $from = this.doc.resolve(from), $to = this.doc.resolve(to)
  if (fitsTrivially($from, $to, slice))
    return this.step(new ReplaceStep(from, to, slice))

  let targetDepths = coveredDepths($from, this.doc.resolve(to))
  // Can't replace the whole document, so remove 0 if it's present
  if (targetDepths[targetDepths.length - 1] == 0) targetDepths.pop()
  // Negative numbers represent not expansion over the whole node at
  // that depth, but replacing from $from.before(-D) to $to.pos.
  let preferredTarget = -($from.depth + 1)
  targetDepths.unshift(preferredTarget)
  // This loop picks a preferred target depth, if one of the covering
  // depths is not outside of a defining node, and adds negative
  // depths for any depth that has $from at its start and does not
  // cross a defining node.
  for (let d = $from.depth, pos = $from.pos - 1; d > 0; d--, pos--) {
    let spec = $from.node(d).type.spec
    if (spec.defining || spec.isolating) break
    if (targetDepths.indexOf(d) > -1) preferredTarget = d
    else if ($from.before(d) == pos) targetDepths.splice(1, 0, -d)
  }
  // Try to fit each possible depth of the slice into each possible
  // target depth, starting with the preferred depths.
  let preferredTargetIndex = targetDepths.indexOf(preferredTarget)

  let leftNodes = [], preferredDepth = slice.openStart
  for (let content = slice.content, i = 0;; i++) {
    let node = content.firstChild
    leftNodes.push(node)
    if (i == slice.openStart) break
    content = node.content
  }
  // Back up if the node directly above openStart, or the node above
  // that separated only by a non-defining textblock node, is defining.
  if (preferredDepth > 0 && leftNodes[preferredDepth - 1].type.spec.defining &&
      $from.node(preferredTargetIndex).type != leftNodes[preferredDepth - 1].type)
    preferredDepth -= 1
  else if (preferredDepth >= 2 && leftNodes[preferredDepth - 1].isTextblock && leftNodes[preferredDepth - 2].type.spec.defining &&
           $from.node(preferredTargetIndex).type != leftNodes[preferredDepth - 2].type)
    preferredDepth -= 2

  for (let j = slice.openStart; j >= 0; j--) {
    let openDepth = (j + preferredDepth + 1) % (slice.openStart + 1)
    let insert = leftNodes[openDepth]
    if (!insert) continue
    for (let i = 0; i < targetDepths.length; i++) {
      // Loop over possible expansion levels, starting with the
      // preferred one
      let targetDepth = targetDepths[(i + preferredTargetIndex) % targetDepths.length], expand = true
      if (targetDepth < 0) { expand = false; targetDepth = -targetDepth }
      let parent = $from.node(targetDepth - 1), index = $from.index(targetDepth - 1)
      if (parent.canReplaceWith(index, index, insert.type, insert.marks))
        return this.replace($from.before(targetDepth), expand ? $to.after(targetDepth) : to,
                            new Slice(closeFragment(slice.content, 0, slice.openStart, openDepth),
                                      openDepth, slice.openEnd))
    }
  }

  let startSteps = this.steps.length
  for (let i = targetDepths.length - 1; i >= 0; i--) {
    this.replace(from, to, slice)
    if (this.steps.length > startSteps) break
    let depth = targetDepths[i]
    if (i < 0) continue
    from = $from.before(depth); to = $to.after(depth)
  }
  return this
}

function closeFragment(fragment, depth, oldOpen, newOpen, parent) {
  if (depth < oldOpen) {
    let first = fragment.firstChild
    fragment = fragment.replaceChild(0, first.copy(closeFragment(first.content, depth + 1, oldOpen, newOpen, first)))
  }
  if (depth > newOpen) {
    let match = parent.contentMatchAt(0)
    let start = match.fillBefore(fragment).append(fragment)
    fragment = start.append(match.matchFragment(start).fillBefore(Fragment.empty, true))
  }
  return fragment
}

// :: (number, number, Node) → this
// Replace the given range with a node, but use `from` and `to` as
// hints, rather than precise positions. When from and to are the same
// and are at the start or end of a parent node in which the given
// node doesn't fit, this method may _move_ them out towards a parent
// that does allow the given node to be placed. When the given range
// completely covers a parent node, this method may completely replace
// that parent node.
Transform.prototype.replaceRangeWith = function(from, to, node) {
  if (!node.isInline && from == to && this.doc.resolve(from).parent.content.size) {
    let point = insertPoint(this.doc, from, node.type)
    if (point != null) from = to = point
  }
  return this.replaceRange(from, to, new Slice(Fragment.from(node), 0, 0))
}

// :: (number, number) → this
// Delete the given range, expanding it to cover fully covered
// parent nodes until a valid replace is found.
Transform.prototype.deleteRange = function(from, to) {
  let $from = this.doc.resolve(from), $to = this.doc.resolve(to)
  let covered = coveredDepths($from, $to)
  for (let i = 0; i < covered.length; i++) {
    let depth = covered[i], last = i == covered.length - 1
    if ((last && depth == 0) || $from.node(depth).type.contentMatch.validEnd)
      return this.delete($from.start(depth), $to.end(depth))
    if (depth > 0 && (last || $from.node(depth - 1).canReplace($from.index(depth - 1), $to.indexAfter(depth - 1))))
      return this.delete($from.before(depth), $to.after(depth))
  }
  for (let d = 1; d <= $from.depth && d <= $to.depth; d++) {
    if (from - $from.start(d) == $from.depth - d && to > $from.end(d) && $to.end(d) - to != $to.depth - d)
      return this.delete($from.before(d), to)
  }
  return this.delete(from, to)
}

// : (ResolvedPos, ResolvedPos) → [number]
// Returns an array of all depths for which $from - $to spans the
// whole content of the nodes at that depth.
function coveredDepths($from, $to) {
  let result = [], minDepth = Math.min($from.depth, $to.depth)
  for (let d = minDepth; d >= 0; d--) {
    let start = $from.start(d)
    if (start < $from.pos - ($from.depth - d) ||
        $to.end(d) > $to.pos + ($to.depth - d) ||
        $from.node(d).type.spec.isolating ||
        $to.node(d).type.spec.isolating) break
    if (start == $to.start(d)) result.push(d)
  }
  return result
}

