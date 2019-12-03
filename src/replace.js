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
  let placed = placeSlice($from, slice)

  let fittedLeft = fitLeft($from, placed)
  let fitted = fitRight($from, $to, fittedLeft)
  if (!fitted) return null
  if (fittedLeft.size != fitted.size && canMoveText($from, $to, fittedLeft)) {
    let d = $to.depth, after = $to.after(d)
    while (d > 1 && after == $to.end(--d)) ++after
    let fittedAfter = fitRight($from, doc.resolve(after), fittedLeft)
    if (fittedAfter)
      return new ReplaceAroundStep(from, after, to, $to.end(), fittedAfter, fittedLeft.size)
  }
  return fitted.size || from != to ? new ReplaceStep(from, to, fitted) : null
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



function fitLeftInner($from, depth, placed, placedBelow) {
  let content = Fragment.empty, openEnd = 0, placedHere = placed[depth]
  if ($from.depth > depth) {
    let inner = fitLeftInner($from, depth + 1, placed, placedBelow || placedHere)
    openEnd = inner.openEnd + 1
    content = Fragment.from($from.node(depth + 1).copy(inner.content))
  }

  if (placedHere) {
    content = content.append(placedHere.content)
    openEnd = placedHere.openEnd
  }
  if (placedBelow) {
    content = content.append($from.node(depth).contentMatchAt($from.indexAfter(depth)).fillBefore(Fragment.empty, true))
    openEnd = 0
  }

  return {content, openEnd}
}

function fitLeft($from, placed) {
  let {content, openEnd} = fitLeftInner($from, 0, placed, false)
  return new Slice(content, $from.depth, openEnd || 0)
}

function fitRightJoin(content, parent, $from, $to, depth, openStart, openEnd) {
  let match, count = content.childCount, matchCount = count - (openEnd > 0 ? 1 : 0)
  let parentNode = openStart < 0 ? parent : $from.node(depth)
  if (openStart < 0)
    match = parentNode.contentMatchAt(matchCount)
  else if (count == 1 && openEnd > 0)
    match = parentNode.contentMatchAt(openStart ? $from.index(depth) : $from.indexAfter(depth))
  else
    match = parentNode.contentMatchAt($from.indexAfter(depth))
      .matchFragment(content, count > 0 && openStart ? 1 : 0, matchCount)

  let toNode = $to.node(depth)
  if (openEnd > 0 && depth < $to.depth) {
    let after = toNode.content.cutByIndex($to.indexAfter(depth)).addToStart(content.lastChild)
    let joinable = match.fillBefore(after, true)
    // Can't insert content if there's a single node stretched across this gap
    if (joinable && joinable.size && openStart > 0 && count == 1) joinable = null

    if (joinable) {
      let inner = fitRightJoin(content.lastChild.content, content.lastChild, $from, $to,
                               depth + 1, count == 1 ? openStart - 1 : -1, openEnd - 1)
      if (inner) {
        let last = content.lastChild.copy(inner)
        if (joinable.size)
          return content.cutByIndex(0, count - 1).append(joinable).addToEnd(last)
        else
          return content.replaceChild(count - 1, last)
      }
    }
  }
  if (openEnd > 0)
    match = match.matchType((count == 1 && openStart > 0 ? $from.node(depth + 1) : content.lastChild).type)

  // If we're here, the next level can't be joined, so we see what
  // happens if we leave it open.
  let toIndex = $to.index(depth)
  if (toIndex == toNode.childCount && !toNode.type.compatibleContent(parent.type)) return null
  let joinable = match.fillBefore(toNode.content, true, toIndex)
  for (let i = toIndex; joinable && i < toNode.content.childCount; i++)
    if (!parentNode.type.allowsMarks(toNode.content.child(i).marks)) joinable = null
  if (!joinable) return null

  if (openEnd > 0) {
    let closed = fitRightClosed(content.lastChild, openEnd - 1, $from, depth + 1,
                                count == 1 ? openStart - 1 : -1)
    content = content.replaceChild(count - 1, closed)
  }
  content = content.append(joinable)
  if ($to.depth > depth)
    content = content.addToEnd(fitRightSeparate($to, depth + 1))
  return content
}

function fitRightClosed(node, openEnd, $from, depth, openStart) {
  let match, content = node.content, count = content.childCount
  if (openStart >= 0)
    match = $from.node(depth).contentMatchAt($from.indexAfter(depth))
      .matchFragment(content, openStart > 0 ? 1 : 0, count)
  else
    match = node.contentMatchAt(count)

  if (openEnd > 0) {
    let closed = fitRightClosed(content.lastChild, openEnd - 1, $from, depth + 1,
                                count == 1 ? openStart - 1 : -1)
    content = content.replaceChild(count - 1, closed)
  }

  return node.copy(content.append(match.fillBefore(Fragment.empty, true)))
}

function fitRightSeparate($to, depth) {
  let node = $to.node(depth)
  let fill = node.contentMatchAt(0).fillBefore(node.content, true, $to.index(depth))
  if ($to.depth > depth) fill = fill.addToEnd(fitRightSeparate($to, depth + 1))
  return node.copy(fill)
}

function normalizeSlice(content, openStart, openEnd) {
  while (openStart > 0 && openEnd > 0 && content.childCount == 1) {
    content = content.firstChild.content
    openStart--
    openEnd--
  }
  return new Slice(content, openStart, openEnd)
}

// : (ResolvedPos, ResolvedPos, number, Slice) → Slice
function fitRight($from, $to, slice) {
  let fitted = fitRightJoin(slice.content, $from.node(0), $from, $to, 0, slice.openStart, slice.openEnd)
  if (!fitted) return null
  return normalizeSlice(fitted, slice.openStart, $to.depth)
}

function fitsTrivially($from, $to, slice) {
  return !slice.openStart && !slice.openEnd && $from.start() == $to.start() &&
    $from.parent.canReplace($from.index(), $to.index(), slice.content)
}

function canMoveText($from, $to, slice) {
  if (!$to.parent.isTextblock) return false

  let parent = slice.openEnd ? nodeRight(slice.content, slice.openEnd)
      : $from.node($from.depth - (slice.openStart - slice.openEnd))
  if (!parent.isTextblock) return false
  for (let i = $to.index(); i < $to.parent.childCount; i++)
    if (!parent.type.allowsMarks($to.parent.child(i).marks)) return false
  let match
  if (slice.openEnd) {
    match = parent.contentMatchAt(parent.childCount)
  } else {
    match = parent.contentMatchAt(parent.childCount)
    if (slice.size) match = match.matchFragment(slice.content, slice.openStart ? 1 : 0)
  }
  match = match.matchFragment($to.parent.content, $to.index())
  return match && match.validEnd
}

function nodeRight(content, depth) {
  for (let i = 1; i < depth; i++) content = content.lastChild.content
  return content.lastChild
}

// Algorithm for 'placing' the elements of a slice into a gap:
//
// We consider the content of each node that is open to the left to be
// independently placeable. I.e. in <p("foo"), p("bar")>, when the
// paragraph on the left is open, "foo" can be placed (somewhere on
// the left side of the replacement gap) independently from p("bar").
//
// So placeSlice splits up a slice into a number of sub-slices,
// along with information on where they can be placed on the given
// left-side edge. It works by walking the open side of the slice,
// from the inside out, and trying to find a landing spot for each
// element, by simultaneously scanning over the gap side. When no
// place is found for an open node's content, it is left in that node.

// : (ResolvedPos, Slice) → [{content: Fragment, openEnd: number, depth: number}]
function placeSlice($from, slice) {
  let frontier = new Frontier($from)
  for (let pass = 1; slice.size && pass <= 3; pass++) {
    let value = frontier.placeSlice(slice.content, slice.openStart, slice.openEnd, pass)
    if (pass == 3 && value != slice && value.size) pass = 0 // Restart if the 3rd pass made progress but left content
    slice = value
  }
  while (frontier.open.length) frontier.closeNode()
  return frontier.placed
}

// Helper class that models the open side of the insert position,
// keeping track of the content match and already inserted content
// at each depth.
class Frontier {
  constructor($pos) {
    // : [{parent: Node, match: ContentMatch, content: Fragment, wrapper: bool, openEnd: number, depth: number}]
    this.open = []
    for (let d = 0; d <= $pos.depth; d++) {
      let parent = $pos.node(d), match = parent.contentMatchAt($pos.indexAfter(d))
      this.open.push({parent, match, content: Fragment.empty, wrapper: false, openEnd: 0, depth: d})
    }
    this.placed = []
  }

  // : (Fragment, number, number, number, ?Node) → Slice
  // Tries to place the content of the given slice, and returns a
  // slice containing unplaced content.
  //
  // pass 1: try to fit directly
  // pass 2: allow wrapper nodes to be introduced
  // pass 3: allow unwrapping of nodes that aren't open
  placeSlice(fragment, openStart, openEnd, pass, parent) {
    if (openStart > 0) {
      let first = fragment.firstChild
      let inner = this.placeSlice(first.content, Math.max(0, openStart - 1),
                                  openEnd && fragment.childCount == 1 ? openEnd - 1 : 0,
                                  pass, first)
      if (inner.content != first.content) {
        if (inner.content.size) {
          fragment = fragment.replaceChild(0, first.copy(inner.content))
          openStart = inner.openStart + 1
        } else {
          if (fragment.childCount == 1) openEnd = 0
          fragment = fragment.cutByIndex(1)
          openStart = 0
        }
      }
    }
    let result = this.placeContent(fragment, openStart, openEnd, pass, parent)
    if (pass > 2 && result.size && openStart == 0) {
      let child = result.content.firstChild, single = result.content.childCount == 1
      this.placeContent(child.content, 0, openEnd && single ? openEnd - 1 : 0, pass, child)
      result = single ? Fragment.empty : new Slice(result.content.cutByIndex(1), 0, openEnd)
    }
    return result
  }

  placeContent(fragment, openStart, openEnd, pass, parent) {
    let i = 0
    // Go over the fragment's children
    for (; i < fragment.childCount; i++) {
      let child = fragment.child(i), placed = false, last = i == fragment.childCount - 1
      // Try each open node in turn, starting from the innermost
      for (let d = this.open.length - 1; d >= 0; d--) {
        let open = this.open[d], wrap

        // If pass > 1, it is allowed to wrap the node to help find a
        // fit, so if findWrapping returns something, we add open
        // nodes to the frontier for that wrapping.
        if (pass > 1 && (wrap = open.match.findWrapping(child.type)) &&
            !(parent && wrap.length && wrap[wrap.length - 1] == parent.type)) {
          while (this.open.length - 1 > d) this.closeNode()
          for (let w = 0; w < wrap.length; w++) {
            open.match = open.match.matchType(wrap[w])
            d++
            open = {parent: wrap[w].create(),
                    match: wrap[w].contentMatch,
                    content: Fragment.empty, wrapper: true, openEnd: 0, depth: d + w}
            this.open.push(open)
          }
        }

        // See if the child fits here
        let match = open.match.matchType(child.type)
        if (!match) {
          let fill = open.match.fillBefore(Fragment.from(child))
          if (fill) {
            for (let j = 0; j < fill.childCount; j++) {
              let ch = fill.child(j)
              this.addNode(open, ch, 0)
              match = open.match.matchFragment(ch)
            }
          } else if (parent && open.match.matchType(parent.type)) {
            // Don't continue looking further up if the parent node
            // would fit here.
            break
          } else {
            continue
          }
        }

        // Close open nodes above this one, since we're starting to
        // add to this.
        while (this.open.length - 1 > d) this.closeNode()
        // Strip marks from the child or close its start when necessary
        child = child.mark(open.parent.type.allowedMarks(child.marks))
        if (openStart) {
          child = closeNodeStart(child, openStart, last ? openEnd : 0)
          openStart = 0
        }
        // Add the child to this open node and adjust its metadata
        this.addNode(open, child, last ? openEnd : 0)
        open.match = match
        if (last) openEnd = 0
        placed = true
        break
      }
      // As soon as we've failed to place a node we stop looking at
      // later nodes
      if (!placed) break
    }
    // Close the current open node if it's not the the root and we
    // either placed up to the end of the node or the the current
    // slice depth's node type matches the open node's type
    if (this.open.length > 1 &&
        (i > 0 && i == fragment.childCount ||
         parent && this.open[this.open.length - 1].parent.type == parent.type))
      this.closeNode()

    return new Slice(fragment.cutByIndex(i), openStart, openEnd)
  }

  addNode(open, node, openEnd) {
    open.content = closeFragmentEnd(open.content, open.openEnd).addToEnd(node)
    open.openEnd = openEnd
  }

  closeNode() {
    let open = this.open.pop()
    if (open.content.size == 0) {
      // Nothing here
    } else if (open.wrapper) {
      this.addNode(this.open[this.open.length - 1], open.parent.copy(open.content), open.openEnd + 1)
    } else {
      this.placed[open.depth] = {depth: open.depth, content: open.content, openEnd: open.openEnd}
    }
  }
}

function closeNodeStart(node, openStart, openEnd) {
  let content = node.content
  if (openStart > 1) {
    let first = closeNodeStart(node.firstChild, openStart - 1, node.childCount == 1 ? openEnd - 1 : 0)
    content = node.content.replaceChild(0, first)
  }
  let fill = node.type.contentMatch.fillBefore(content, openEnd == 0)
  return node.copy(fill.append(content))
}

function closeNodeEnd(node, depth) {
  let content = node.content
  if (depth > 1) {
    let last = closeNodeEnd(node.lastChild, depth - 1)
    content = node.content.replaceChild(node.childCount - 1, last)
  }
  let fill = node.contentMatchAt(node.childCount).fillBefore(Fragment.empty, true)
  return node.copy(content.append(fill))
}

function closeFragmentEnd(fragment, depth) {
  return depth ? fragment.replaceChild(fragment.childCount - 1, closeNodeEnd(fragment.lastChild, depth)) : fragment
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
