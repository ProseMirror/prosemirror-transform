const {Slice, Fragment} = require("prosemirror-model")

const {Transform} = require("./transform")
const {ReplaceStep, ReplaceAroundStep} = require("./replace_step")

function canCut(node, start, end) {
  return (start == 0 || node.canReplace(start, node.childCount)) &&
    (end == node.childCount || node.canReplace(0, end))
}

// :: (NodeRange) → ?number
// Try to find a target depth to which the content in the given range
// can be lifted.
function liftTarget(range) {
  let parent = range.parent
  let content = parent.content.cutByIndex(range.startIndex, range.endIndex)
  for (let depth = range.depth;; --depth) {
    let node = range.$from.node(depth), index = range.$from.index(depth), endIndex = range.$to.indexAfter(depth)
    if (depth < range.depth && node.canReplace(index, endIndex, content))
      return depth
    if (depth == 0 || !canCut(node, index, endIndex)) break
  }
}
exports.liftTarget = liftTarget

// :: (NodeRange, number) → Transform
// Split the content in the given range off from its parent, if there
// is sibling content before or after it, and move it up the tree to
// the depth specified by `target`. You'll probably want to use
// `liftTarget` to compute `target`, in order to be sure the lift is
// valid.
Transform.prototype.lift = function(range, target) {
  let {$from, $to, depth} = range

  let gapStart = $from.before(depth + 1), gapEnd = $to.after(depth + 1)
  let start = gapStart, end = gapEnd

  let before = Fragment.empty, openLeft = 0
  for (let d = depth, splitting = false; d > target; d--)
    if (splitting || $from.index(d) > 0) {
      splitting = true
      before = Fragment.from($from.node(d).copy(before))
      openLeft++
    } else {
      start--
    }
  let after = Fragment.empty, openRight = 0
  for (let d = depth, splitting = false; d > target; d--)
    if (splitting || $to.after(d + 1) < $to.end(d)) {
      splitting = true
      after = Fragment.from($to.node(d).copy(after))
      openRight++
    } else {
      end++
    }

  return this.step(new ReplaceAroundStep(start, end, gapStart, gapEnd,
                                         new Slice(before.append(after), openLeft, openRight),
                                         before.size - openLeft, true))
}

// :: (NodeRange, NodeType, ?Object) → ?[{type: NodeType, attrs: ?Object}]
// Try to find a valid way to wrap the content in the given range in a
// node of the given type. May introduce extra nodes around and inside
// the wrapper node, if necessary. Returns null if no valid wrapping
// could be found.
function findWrapping(range, nodeType, attrs, innerRange = range) {
  let wrap = {type: nodeType, attrs}
  let around = findWrappingOutside(range, wrap)
  let inner = around && findWrappingInside(innerRange, wrap)
  if (!inner) return null
  return around.concat(wrap).concat(inner)
}
exports.findWrapping = findWrapping

function findWrappingOutside(range, wrap) {
  let {parent, startIndex, endIndex} = range
  let around = parent.contentMatchAt(startIndex).findWrapping(wrap.type, wrap.attrs)
  if (!around) return null
  let outer = around.length ? around[0] : wrap
  if (!parent.canReplaceWith(startIndex, endIndex, outer.type, outer.attrs))
    return null
  return around
}

function findWrappingInside(range, wrap) {
  let {parent, startIndex, endIndex} = range
  let inner = parent.child(startIndex)
  let inside = wrap.type.contentExpr.start(wrap.attrs).findWrappingFor(inner)
  if (!inside) return null
  let last = inside.length ? inside[inside.length - 1] : wrap
  let innerMatch = last.type.contentExpr.start(last.attrs)
  for (let i = startIndex; i < endIndex; i++)
    innerMatch = innerMatch && innerMatch.matchNode(parent.child(i))
  if (!innerMatch || !innerMatch.validEnd()) return null
  return inside
}

// :: (NodeRange, [{type: NodeType, attrs: ?Object}]) → Transform
// Wrap the given [range](#model.NodeRange) in the given set of wrappers.
// The wrappers are assumed to be valid in this position, and should
// probably be computed with `findWrapping`.
Transform.prototype.wrap = function(range, wrappers) {
  let content = Fragment.empty
  for (let i = wrappers.length - 1; i >= 0; i--)
    content = Fragment.from(wrappers[i].type.create(wrappers[i].attrs, content))

  let start = range.start, end = range.end
  return this.step(new ReplaceAroundStep(start, end, start, end, new Slice(content, 0, 0), wrappers.length, true))
}

// :: (number, ?number, NodeType, ?Object) → Transform
// Set the type of all textblocks (partly) between `from` and `to` to
// the given node type with the given attributes.
Transform.prototype.setBlockType = function(from, to = from, type, attrs) {
  if (!type.isTextblock) throw new RangeError("Type given to setBlockType should be a textblock")
  let mapFrom = this.steps.length
  this.doc.nodesBetween(from, to, (node, pos) => {
    if (node.isTextblock && !node.hasMarkup(type, attrs)) {
      // Ensure all markup that isn't allowed in the new node type is cleared
      this.clearNonMatching(this.mapping.slice(mapFrom).map(pos, 1), type.contentExpr.start(attrs))
      let mapping = this.mapping.slice(mapFrom)
      let startM = mapping.map(pos, 1), endM = mapping.map(pos + node.nodeSize, 1)
      this.step(new ReplaceAroundStep(startM, endM, startM + 1, endM - 1,
                                      new Slice(Fragment.from(type.create(attrs)), 0, 0), 1, true))
      return false
    }
  })
  return this
}

// :: (number, ?NodeType, ?Object) → Transform
// Change the type and attributes of the node after `pos`.
Transform.prototype.setNodeType = function(pos, type, attrs) {
  let node = this.doc.nodeAt(pos)
  if (!node) throw new RangeError("No node at given position")
  if (!type) type = node.type
  if (node.isLeaf)
    return this.replaceWith(pos, pos + node.nodeSize, type.create(attrs, null, node.marks))

  if (!type.validContent(node.content, attrs))
    throw new RangeError("Invalid content for node type " + type.name)

  return this.step(new ReplaceAroundStep(pos, pos + node.nodeSize, pos + 1, pos + node.nodeSize - 1,
                                         new Slice(Fragment.from(type.create(attrs)), 0, 0), 1, true))
}

// :: (Node, number, ?[?{type: NodeType, attrs: ?Object}]) → bool
// Check whether splitting at the given position is allowed.
function canSplit(doc, pos, depth = 1, typesAfter) {
  let $pos = doc.resolve(pos), base = $pos.depth - depth
  if (base < 0 ||
      !$pos.parent.canReplace($pos.index(), $pos.parent.childCount) ||
      !$pos.parent.canReplace(0, $pos.indexAfter()))
    return false
  for (let d = $pos.depth - 1, i = depth - 1; d > base; d--, i--) {
    let node = $pos.node(d), index = $pos.index(d)
    let typeAfter = typesAfter && typesAfter[i]
    if (!node.canReplace(0, index) ||
        !node.canReplaceWith(index, node.childCount, typeAfter ? typeAfter.type : $pos.node(d + 1).type,
                             typeAfter ? typeAfter.attrs : $pos.node(d + 1).attrs))
      return false
  }
  let index = $pos.indexAfter(base)
  let baseType = typesAfter && typesAfter[0]
  return $pos.node(base).canReplaceWith(index, index, baseType ? baseType.type : $pos.node(base + 1).type,
                                        baseType ? baseType.attrs : $pos.node(base + 1).attrs)
}
exports.canSplit = canSplit

// :: (number, ?number, ?[?{type: NodeType, attrs: ?Object}]) → Transform
// Split the node at the given position, and optionally, if `depth` is
// greater than one, any number of nodes above that. By default, the
// parts split off will inherit the node type of the original node.
// This can be changed by passing an array of types and attributes to
// use after the split.
Transform.prototype.split = function(pos, depth = 1, typesAfter) {
  let $pos = this.doc.resolve(pos), before = Fragment.empty, after = Fragment.empty
  for (let d = $pos.depth, e = $pos.depth - depth, i = depth - 1; d > e; d--, i--) {
    before = Fragment.from($pos.node(d).copy(before))
    let typeAfter = typesAfter && typesAfter[i]
    after = Fragment.from(typeAfter ? typeAfter.type.create(typeAfter.attrs, after) : $pos.node(d).copy(after))
  }
  return this.step(new ReplaceStep(pos, pos, new Slice(before.append(after), depth, depth, true)))
}

// :: (Node, number) → bool
// Test whether the blocks before and after a given position can be
// joined.
function canJoin(doc, pos) {
  let $pos = doc.resolve(pos), index = $pos.index()
  return joinable($pos.nodeBefore, $pos.nodeAfter) &&
    $pos.parent.canReplace(index, index + 1)
}
exports.canJoin = canJoin

function joinable(a, b) {
  return a && b && !a.isLeaf && a.canAppend(b)
}

// :: (Node, number, ?number) → ?number
// Find an ancestor of the given position that can be joined to the
// block before (or after if `dir` is positive). Returns the joinable
// point, if any.
function joinPoint(doc, pos, dir = -1) {
  let $pos = doc.resolve(pos)
  for (let d = $pos.depth;; d--) {
    let before, after
    if (d == $pos.depth) {
      before = $pos.nodeBefore
      after = $pos.nodeAfter
    } else if (dir > 0) {
      before = $pos.node(d + 1)
      after = $pos.node(d).maybeChild($pos.index(d) + 1)
    } else {
      before = $pos.node(d).maybeChild($pos.index(d) - 1)
      after = $pos.node(d + 1)
    }
    if (before && !before.isTextblock && joinable(before, after)) return pos
    if (d == 0) break
    pos = dir < 0 ? $pos.before(d) : $pos.after(d)
  }
}
exports.joinPoint = joinPoint

// :: (number, ?number, ?bool) → Transform
// Join the blocks around the given position. If depth is 2, their
// last and first siblings are also joined, and so on.
Transform.prototype.join = function(pos, depth = 1) {
  let step = new ReplaceStep(pos - depth, pos + depth, Slice.empty, true)
  return this.step(step)
}

// :: (Node, number, NodeType, ?Object) → ?number
// Try to find a point where a node of the given type can be inserted
// near `pos`, by searching up the node hierarchy when `pos` itself
// isn't a valid place but is at the start or end of a node. Return
// null if no position was found.
function insertPoint(doc, pos, nodeType, attrs) {
  let $pos = doc.resolve(pos)
  if ($pos.parent.canReplaceWith($pos.index(), $pos.index(), nodeType, attrs)) return pos

  if ($pos.parentOffset == 0)
    for (let d = $pos.depth - 1; d >= 0; d--) {
      let index = $pos.index(d)
      if ($pos.node(d).canReplaceWith(index, index, nodeType, attrs)) return $pos.before(d + 1)
      if (index > 0) return null
    }
  if ($pos.parentOffset == $pos.parent.content.size)
    for (let d = $pos.depth - 1; d >= 0; d--) {
      let index = $pos.indexAfter(d)
      if ($pos.node(d).canReplaceWith(index, index, nodeType, attrs)) return $pos.after(d + 1)
      if (index < $pos.node(d).childCount) return null
    }
}
exports.insertPoint = insertPoint
