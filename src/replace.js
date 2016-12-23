const {Fragment, Slice} = require("prosemirror-model")

const {ReplaceStep, ReplaceAroundStep} = require("./replace_step")
const {Transform} = require("./transform")
const {insertPoint} = require("./structure")

// :: (number, number, Slice) → Transform
// Replace a range of the document with a given slice, using `from`,
// `to`, and the slice's [`openLeft`](#model.Slice.openLeft) property
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

  let $from = this.doc.resolve(from)
  if (fitsTrivially($from, this.doc.resolve(to), slice))
    return this.step(new ReplaceStep(from, to, slice))

  let canExpand = coveredDepths($from, this.doc.resolve(to)), preferredExpand = 0
  canExpand.unshift($from.depth + 1)
  for (let d = $from.depth; d > 0; d--) {
    if ($from.node(d).type.spec.defining) break
    let found = canExpand.indexOf(d, 1)
    if (found > -1) preferredExpand = found
  }

  let leftNodes = [], preferredDepth = slice.openLeft
  for (let content = slice.content, i = 0;; i++) {
    let node = content.firstChild
    leftNodes.push(node)
    if (i == slice.openLeft) break
    content = node.content
  }
  // Back up if the node directly above openLeft, or the node above
  // that separated only by a non-defining textblock node, is defining.
  if (preferredDepth > 0 && leftNodes[preferredDepth - 1].type.spec.defining)
    preferredDepth -= 1
  else if (preferredDepth >= 2 && leftNodes[preferredDepth - 1].isTextblock && leftNodes[preferredDepth - 2].type.spec.defining)
    preferredDepth -= 2

  for (let j = slice.openLeft; j >= 0; j--) {
    let openDepth = (j + preferredDepth + 1) % (slice.openLeft + 1)
    let insert = leftNodes[openDepth]
    if (!insert) continue
    for (let i = 0; i < canExpand.length; i++) {
      // Loop over possible expansion levels, starting with the
      // preferred one
      let expandDepth = canExpand[(i + preferredExpand) % canExpand.length]
      let parent = $from.node(expandDepth - 1), index = $from.index(expandDepth - 1)
      if (parent.canReplaceWith(index, index, insert.type, insert.attrs, insert.marks))
        return this.replace($from.before(expandDepth), expandDepth > $from.depth ? to : $from.after(expandDepth),
                            new Slice(closeFragment(slice.content, 0, slice.openLeft, openDepth),
                                      openDepth, slice.openRight))
    }
  }

  return this.replace(from, to, slice)
}

function closeFragment(fragment, depth, oldOpen, newOpen, parent) {
  if (depth < oldOpen) {
    let first = fragment.firstChild
    fragment = fragment.replaceChild(0, first.copy(closeFragment(first.content, depth + 1, oldOpen, newOpen, first)))
  }
  if (depth > newOpen)
    fragment = parent.contentMatchAt(0).fillBefore(fragment).append(fragment)
  return fragment
}

// :: (number, number, Node) → Transform
// Replace the given range with a node, but use `from` and `to` as
// hints, rather than precise positions. When from and to are the same
// and are at the start or end of a parent node in which the given
// node doesn't fit, this method may _move_ them out towards a parent
// that does allow the given node to be placed. When the given range
// completely covers a parent node, this method may completely replace
// that parent node.
Transform.prototype.replaceRangeWith = function(from, to, node) {
  if (!node.isInline && from == to && this.doc.resolve(from).parent.content.size) {
    let point = insertPoint(this.doc, from, node.type, node.attrs)
    if (point != null) from = to = point
  }
  return this.replaceRange(from, to, new Slice(Fragment.from(node), 0, 0))
}

// :: (number, number) → Transform
// Delete the given range, and any fully covered parent nodes that are
// not allowed to be empty.
Transform.prototype.deleteRange = function(from, to) {
  let $from = this.doc.resolve(from)
  let covered = coveredDepths($from, this.doc.resolve(to)), grown = false
  // Find the innermost covered node that allows its whole content to
  // be deleted
  for (let i = 0; i < covered.length; i++) {
    if ($from.node(covered[i]).contentMatchAt(0).validEnd()) {
      from = $from.start(covered[i])
      to = $from.end(covered[i])
      grown = true
      break
    }
  }
  // If no such node was found and the outermose covered node can be
  // deleted entirely, do that
  if (!grown && covered.length) {
    let depth = covered[covered.length - 1]
    if ($from.node(depth - 1).canReplace($from.index(depth - 1), $from.indexAfter(depth - 1))) {
      from = $from.before(depth)
      to = $from.after(depth)
    }
  }
  return this.delete(from, to)
}

// : (ResolvedPos, ResolvedPos) → [number]
// Returns an array of all depths for which $from - $to spans the
// whole content of the node at that depth.
function coveredDepths($from, $to) {
  let result = []
  for (let i = 0; i < $from.depth; i++) {
    let depth = $from.depth - i
    if ($from.pos - i > $from.start(depth)) break
    if ($to.depth >= depth && $to.pos + ($to.depth - depth) == $from.end(depth)) result.push(depth)
  }
  return result
}

// :: (number, number) → Transform
// Delete the content between the given positions.
Transform.prototype.delete = function(from, to) {
  return this.replace(from, to, Slice.empty)
}

// :: (Node, number, ?number, ?Slice) → ?Step
// "Fit" a slice into a given position in the document, producing a
// [step](#transform.Step) that inserts it.
function replaceStep(doc, from, to = from, slice = Slice.empty) {
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
  return new ReplaceStep(from, to, fitted)
}
exports.replaceStep = replaceStep

// :: (number, ?number, ?Slice) → Transform
// Replace the part of the document between `from` and `to` with the
// given `slice`.
Transform.prototype.replace = function(from, to = from, slice = Slice.empty) {
  let step = replaceStep(this.doc, from, to, slice)
  if (step) this.step(step)
  return this
}

// :: (number, number, union<Fragment, Node, [Node]>) → Transform
// Replace the given range with the given content, which may be a
// fragment, node, or array of nodes.
Transform.prototype.replaceWith = function(from, to, content) {
  return this.replace(from, to, new Slice(Fragment.from(content), 0, 0))
}

// :: (number, union<Fragment, Node, [Node]>) → Transform
// Insert the given content at the given position.
Transform.prototype.insert = function(pos, content) {
  return this.replaceWith(pos, pos, content)
}



function fitLeftInner($from, depth, placed, placedBelow) {
  let content = Fragment.empty, openRight = 0, placedHere = placed[depth]
  if ($from.depth > depth) {
    let inner = fitLeftInner($from, depth + 1, placed, placedBelow || placedHere)
    openRight = inner.openRight + 1
    content = Fragment.from($from.node(depth + 1).copy(inner.content))
  }

  if (placedHere) {
    content = content.append(placedHere.content)
    openRight = placedHere.openRight
  }
  if (placedBelow) {
    content = content.append($from.node(depth).contentMatchAt($from.indexAfter(depth)).fillBefore(Fragment.empty, true))
    openRight = 0
  }

  return {content, openRight}
}

function fitLeft($from, placed) {
  let {content, openRight} = fitLeftInner($from, 0, placed, false)
  return new Slice(content, $from.depth, openRight || 0)
}

function fitRightJoin(content, parent, $from, $to, depth, openLeft, openRight) {
  let match, count = content.childCount, matchCount = count - (openRight > 0 ? 1 : 0)
  if (openLeft < 0)
    match = parent.contentMatchAt(matchCount)
  else if (count == 1 && openRight > 0)
    match = $from.node(depth).contentMatchAt(openLeft ? $from.index(depth) : $from.indexAfter(depth))
  else
    match = $from.node(depth).contentMatchAt($from.indexAfter(depth))
      .matchFragment(content, count > 0 && openLeft ? 1 : 0, matchCount)

  let toNode = $to.node(depth)
  if (openRight > 0 && depth < $to.depth) {
    let after = toNode.content.cutByIndex($to.indexAfter(depth)).addToStart(content.lastChild)
    let joinable = match.fillBefore(after, true)
    // Can't insert content if there's a single node stretched across this gap
    if (joinable && joinable.size && openLeft > 0 && count == 1) joinable = null

    if (joinable) {
      let inner = fitRightJoin(content.lastChild.content, content.lastChild, $from, $to,
                               depth + 1, count == 1 ? openLeft - 1 : -1, openRight - 1)
      if (inner) {
        let last = content.lastChild.copy(inner)
        if (joinable.size)
          return content.cutByIndex(0, count - 1).append(joinable).addToEnd(last)
        else
          return content.replaceChild(count - 1, last)
      }
    }
  }
  if (openRight > 0)
    match = match.matchNode(count == 1 && openLeft > 0 ? $from.node(depth + 1) : content.lastChild)

  // If we're here, the next level can't be joined, so we see what
  // happens if we leave it open.
  let toIndex = $to.index(depth)
  if (toIndex == toNode.childCount && !toNode.type.compatibleContent(parent.type)) return null
  let joinable = match.fillBefore(toNode.content, true, toIndex)
  if (!joinable) return null

  if (openRight > 0) {
    let closed = fitRightClosed(content.lastChild, openRight - 1, $from, depth + 1,
                                count == 1 ? openLeft - 1 : -1)
    content = content.replaceChild(count - 1, closed)
  }
  content = content.append(joinable)
  if ($to.depth > depth)
    content = content.addToEnd(fitRightSeparate($to, depth + 1))
  return content
}

function fitRightClosed(node, openRight, $from, depth, openLeft) {
  let match, content = node.content, count = content.childCount
  if (openLeft >= 0)
    match = $from.node(depth).contentMatchAt($from.indexAfter(depth))
      .matchFragment(content, openLeft > 0 ? 1 : 0, count)
  else
    match = node.contentMatchAt(count)

  if (openRight > 0) {
    let closed = fitRightClosed(content.lastChild, openRight - 1, $from, depth + 1,
                                count == 1 ? openLeft - 1 : -1)
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

function normalizeSlice(content, openLeft, openRight) {
  while (openLeft > 0 && openRight > 0 && content.childCount == 1) {
    content = content.firstChild.content
    openLeft--
    openRight--
  }
  return new Slice(content, openLeft, openRight)
}

// : (ResolvedPos, ResolvedPos, number, Slice) → Slice
function fitRight($from, $to, slice) {
  let fitted = fitRightJoin(slice.content, $from.node(0), $from, $to, 0, slice.openLeft, slice.openRight)
  if (!fitted) return null
  return normalizeSlice(fitted, slice.openLeft, $to.depth)
}

function fitsTrivially($from, $to, slice) {
  return !slice.openLeft && !slice.openRight && $from.start() == $to.start() &&
    $from.parent.canReplace($from.index(), $to.index(), slice.content)
}

function canMoveText($from, $to, slice) {
  if (!$to.parent.isTextblock) return false

  let match
  if (!slice.openRight) {
    let parent = $from.node($from.depth - (slice.openLeft - slice.openRight))
    if (!parent.isTextblock) return false
    match = parent.contentMatchAt(parent.childCount)
    if (slice.size)
      match = match.matchFragment(slice.content, slice.openLeft ? 1 : 0)
  } else {
    let parent = nodeRight(slice.content, slice.openRight)
    if (!parent.isTextblock) return false
    match = parent.contentMatchAt(parent.childCount)
  }
  match = match.matchFragment($to.parent.content, $to.index())
  return match && match.validEnd()
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
//
// If the outer content can't be placed, a set of wrapper nodes is
// made up for it (by rooting it in the document node type using
// findWrapping), and the algorithm continues to iterate over those.
// This is guaranteed to find a fit, since both stacks now start with
// the same node type (doc).

function nodeLeft(content, depth) {
  for (let i = 1; i < depth; i++) content = content.firstChild.content
  return content.firstChild
}

function nodeRight(content, depth) {
  for (let i = 1; i < depth; i++) content = content.lastChild.content
  return content.lastChild
}

// : (ResolvedPos, Slice) → [{content: Fragment, openRight: number, depth: number}]
function placeSlice($from, slice) {
  let dFrom = $from.depth, unplaced = null
  let placed = [], parents = null

  // Loop over the open side of the slice, trying to find a place for
  // each open fragment.
  for (let dSlice = slice.openLeft;; --dSlice) {
    // Get the components of the node at this level
    let curType, curAttrs, curFragment
    if (dSlice >= 0) {
      if (dSlice > 0) { // Inside slice
        ;({type: curType, attrs: curAttrs, content: curFragment} = nodeLeft(slice.content, dSlice))
      } else if (dSlice == 0) { // Top of slice
        curFragment = slice.content
      }
      if (dSlice < slice.openLeft) curFragment = curFragment.cut(curFragment.firstChild.nodeSize)
    } else { // Outside slice, in generated wrappers (see below)
      curFragment = Fragment.empty
      let parent = parents[parents.length + dSlice - 1]
      curType = parent.type
      curAttrs = parent.attrs
    }
    // If the last iteration left unplaced content, include it in the fragment
    if (unplaced) curFragment = curFragment.addToStart(unplaced)

    // If there's nothing left to place, we're done
    if (curFragment.size == 0 && dSlice <= 0) break

    // This will go through the positions in $from, down from dFrom,
    // to find a fit
    let found = findPlacement(curFragment, $from, dFrom, placed)
    if (found) {
      // If there was a fit, store it, and consider this content placed
      if (found.fragment.size > 0) placed[found.depth] = {
        content: found.fragment,
        openRight: endOfContent(slice, dSlice) ? slice.openRight - dSlice : 0,
        depth: found.depth
      }
      // If that was the last of the content, we're done
      if (dSlice <= 0) break
      unplaced = null
      dFrom = found.depth - (curType == $from.node(found.depth).type ? 1 : 0)
    } else {
      if (dSlice == 0) {
        // This is the top of the slice, and we haven't found a place to insert it.
        let top = $from.node(0)
        // Try to find a wrapping that makes its first child fit in the top node.
        let wrap = top.contentMatchAt($from.index(0)).findWrappingFor(curFragment.firstChild)
        // If no such thing exists, give up.
        if (!wrap || wrap.length == 0) break
        let last = wrap[wrap.length - 1]
        // Check that the fragment actually fits in the wrapping.
        if (!last.type.contentExpr.matches(last.attrs, curFragment)) break
        // Store the result for subsequent iterations.
        parents = [{type: top.type, attrs: top.attrs}].concat(wrap)
        ;({type: curType, attrs: curAttrs} = last)
      }
      if (curFragment.size) {
        curFragment = curType.contentExpr.start(curAttrs).fillBefore(curFragment, true).append(curFragment)
        unplaced = curType.create(curAttrs, curFragment)
      } else {
        unplaced = null
      }
    }
  }

  return placed
}

function endOfContent(slice, depth) {
  for (let i = 0, content = slice.content; i < depth; i++) {
    if (content.childCount > 1) return false
    content = content.firstChild.content
  }
  return true
}

function findPlacement(fragment, $from, start, placed) {
  let hasMarks = false
  for (let i = 0; i < fragment.childCount; i++)
    if (fragment.child(i).marks.length) hasMarks = true
  for (let d = start; d >= 0; d--) {
    let startMatch = $from.node(d).contentMatchAt($from.indexAfter(d))
    let existing = placed[d]
    if (existing) startMatch = startMatch.matchFragment(existing.content)
    let match = startMatch.fillBefore(fragment)
    if (match) return {depth: d, fragment: (existing ? existing.content.append(match) : match).append(fragment)}
    if (hasMarks) {
      let stripped = matchStrippingMarks(startMatch, fragment)
      if (stripped) return {depth: d, fragment: existing ? existing.content.append(stripped) : stripped}
    }
  }
}

function matchStrippingMarks(match, fragment) {
  let newNodes = []
  for (let i = 0; i < fragment.childCount; i++) {
    let node = fragment.child(i), stripped = node.mark(node.marks.filter(m => match.allowsMark(m.type)))
    match = match.matchNode(stripped)
    if (!match) return null
    newNodes.push(stripped)
  }
  return Fragment.from(newNodes)
}
