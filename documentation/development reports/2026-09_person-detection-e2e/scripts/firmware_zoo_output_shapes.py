"""All input/output tensors of the firmware model-zoo detectors, from local files."""

import pathlib as _pl

# Repo root = four levels up from this file; .env lives there, backend/ beside it.
_REPO = _pl.Path(__file__).resolve().parents[4]


from ethosu.vela.tflite.Model import Model

TYPES = {
    0: "FLOAT32",
    1: "FLOAT16",
    2: "INT32",
    3: "UINT8",
    4: "INT64",
    7: "INT16",
    9: "INT8",
}
ZOO = _REPO.parent / "Seeed_Grove_Vision_AI_Module_V2" / "model_zoo"  # sibling checkout

for f in sorted(ZOO.rglob("*.tflite")):
    print(f"\n=== {f.relative_to(ZOO)}  ({f.stat().st_size} bytes)")
    try:
        model = Model.GetRootAs(bytearray(f.read_bytes()), 0)
        sg = model.Subgraphs(0)
        for i in range(sg.InputsLength()):
            t = sg.Tensors(sg.Inputs(i))
            shape = [t.Shape(j) for j in range(t.ShapeLength())]
            print(f"   in [{i}] {shape} {TYPES.get(t.Type(), t.Type())}")
        for i in range(sg.OutputsLength()):
            t = sg.Tensors(sg.Outputs(i))
            shape = [t.Shape(j) for j in range(t.ShapeLength())]
            nm = t.Name().decode("utf-8", "replace") if t.Name() else "?"
            note = ""
            if len(shape) == 3:
                a, b = shape[1], shape[2]
                ch = min(a, b)
                note = (
                    f"   <- channels={ch}: 4 bbox + {ch - 4} class scores"
                    if ch > 4
                    else f"   <- channels={ch}: bbox only, no class scores"
                )
            print(
                f"   out[{i}] {shape} {TYPES.get(t.Type(), t.Type())} name={nm[:50]}{note}"
            )
    except Exception as e:  # noqa: BLE001 - a non-flatbuffer file is reported, not fatal
        print(f"   parse failed: {e}")
