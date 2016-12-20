This module defines a way to transform documents. You can read more
about transformations in [this guide](guide/transform.html).

### Steps

Transforming happens in `Step`s, which are atomic, well-defined
modifications to a document. [Applying](#transform.Step.apply) a step
produces a new document.

Each step provides a [change map](#transform.StepMap) that maps
positions in the old document to position in the transformed document.
Steps can be [inverted](#transform.Step.invert) to create a step that
undoes their effect, and chained together in a convenience object
called a [`Transform`](#transform.Transform).

@Step
@StepResult
@ReplaceStep
@ReplaceAroundStep
@AddMarkStep
@RemoveMarkStep

### Position Mapping

Mapping positions from one document to another by running through the
[replacements](#transform.StepMap) produced by steps is a fundamental
operation in ProseMirror.

@Mappable
@MapResult
@StepMap
@Mapping

### Transform Helpers

Because you often need to collect a number of steps together to effect
a composite change, ProseMirror provides an abstraction to make this
easy. A value of this class is also the payload in the
[transform action](#state.TransformAction).

@Transform

The following helper functions can be useful when creating
transformations or determining whether they are even possible.

@replaceStep
@liftTarget
@findWrapping
@canSplit
@canJoin
@joinPoint
@insertPoint
