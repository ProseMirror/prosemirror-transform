import ist from "ist";
import { Fragment, Slice } from "prosemirror-model";
import { blockquote, p } from "prosemirror-test-builder";
import { ReplaceAroundStep, StepMap } from "prosemirror-transform";

describe("ReplaceAroundStep", () => {
  it("can map if its from is positive", () => {
    let slice = new Slice(Fragment.from(blockquote()), 0, 0);
    // Wrap the content between 10 and 20 in a blockquote
    let step = new ReplaceAroundStep(10, 20, 10, 20, slice, 1, true);
    let mappedStep = step.map(StepMap.offset(100));
    ist(mappedStep?.from, 110);
    ist(mappedStep?.to, 120);
    ist(mappedStep?.gapFrom, 110);
    ist(mappedStep?.gapTo, 120);
  });

  it("can map if its from is 0", () => {
    let slice = new Slice(Fragment.from(blockquote()), 0, 0);
    // Wrap the content between 0 and 20 in a blockquote
    let step = new ReplaceAroundStep(0, 20, 0, 20, slice, 1, true);
    let mappedStep = step.map(StepMap.offset(100));
    ist(mappedStep?.from, 100);
    ist(mappedStep?.to, 120);
    ist(mappedStep?.gapFrom, 100);
    ist(mappedStep?.gapTo, 120);
  });
});
