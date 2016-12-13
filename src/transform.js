const {Mapping} = require("./map")

class TransformError extends Error {}
exports.TransformError = TransformError

// ::- Abstraction to build up and track such an array of
// [steps](#transform.Step).
//
// The high-level transforming methods return the `Transform` object
// itself, so that they can be chained.
class Transform {
  // :: (Node)
  // Create a transformation that starts with the given document.
  constructor(doc) {
    // :: Node
    // The current document (the result of applying the steps in the
    // transform).
    this.doc = doc
    // :: [Step]
    // The steps in this transform.
    this.steps = []
    // :: [Node]
    // The documents before each of the steps.
    this.docs = []
    // :: Mapping
    // A mapping with the maps for each of the steps in this transform.
    this.mapping = new Mapping
  }

  // :: Node The document at the start of the transformation.
  get before() { return this.docs.length ? this.docs[0] : this.doc }

  // :: (step: Step) → Transform
  // Apply a new step in this transformation, saving the result.
  // Throws an error when the step fails.
  step(object) {
    let result = this.maybeStep(object)
    if (result.failed) throw new TransformError(result.failed)
    return this
  }

  // :: (Step) → StepResult
  // Try to apply a step in this transformation, ignoring it if it
  // fails. Returns the step result.
  maybeStep(step) {
    let result = step.apply(this.doc)
    if (!result.failed) {
      this.docs.push(this.doc)
      this.steps.push(step)
      this.mapping.appendMap(step.getMap())
      this.doc = result.doc
    }
    return result
  }
}
exports.Transform = Transform
