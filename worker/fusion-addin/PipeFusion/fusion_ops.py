"""Everything here talks to Fusion 360 and must run on its main thread (the dispatcher in PipeFusion.py takes care of that).

Imported only inside Fusion: ``adsk`` does not exist anywhere else.
"""

import os
import tempfile

import adsk.core
import adsk.fusion

_VIEW_ORIENTATIONS = {
    "iso": adsk.core.ViewOrientations.IsoTopRightViewOrientation,
    "front": adsk.core.ViewOrientations.FrontViewOrientation,
    "back": adsk.core.ViewOrientations.BackViewOrientation,
    "top": adsk.core.ViewOrientations.TopViewOrientation,
    "bottom": adsk.core.ViewOrientations.BottomViewOrientation,
    "left": adsk.core.ViewOrientations.LeftViewOrientation,
    "right": adsk.core.ViewOrientations.RightViewOrientation,
}


def _app():
    return adsk.core.Application.get()


def _design():
    design = adsk.fusion.Design.cast(_app().activeProduct)
    if design is None:
        raise RuntimeError("The active document is not a Fusion design (open or create one first)")
    return design


def _read_and_remove(path):
    try:
        with open(path, "rb") as handle:
            return handle.read()
    finally:
        try:
            os.remove(path)
        except OSError:
            pass


def _temp_path(suffix):
    descriptor, path = tempfile.mkstemp(prefix="pipe-fusion-", suffix=suffix)
    os.close(descriptor)
    return path


def health():
    app = _app()
    document = app.activeDocument
    return {"app": app.name, "version": app.version, "document": document.name if document else None}


def info():
    app = _app()
    document = app.activeDocument
    result = {"document": document.name if document else None, "design": None}
    design = adsk.fusion.Design.cast(app.activeProduct)
    if design is None:
        return result

    root = design.rootComponent
    bodies = []
    for body in root.bRepBodies:
        box = body.boundingBox
        props = body.physicalProperties
        bodies.append(
            {
                "name": body.name,
                "visible": body.isVisible,
                # Fusion's API works in centimetres, kilograms and square/cubic centimetres.
                "boundingBoxCm": [
                    [box.minPoint.x, box.minPoint.y, box.minPoint.z],
                    [box.maxPoint.x, box.maxPoint.y, box.maxPoint.z],
                ],
                "volumeCm3": props.volume,
                "areaCm2": props.area,
                "massKg": props.mass,
            }
        )
    result["design"] = {
        "units": design.unitsManager.defaultLengthUnits,
        "components": design.allComponents.count,
        "occurrences": root.allOccurrences.count,
        "bodies": bodies,
        "userParameters": [{"name": p.name, "expression": p.expression} for p in design.userParameters],
    }
    return result


def screenshot(view, width, height):
    app = _app()
    viewport = app.activeViewport
    if viewport is None:
        raise RuntimeError("There is no active viewport (is a design open?)")
    camera = viewport.camera
    camera.isSmoothTransition = False
    camera.viewOrientation = _VIEW_ORIENTATIONS[view]
    viewport.camera = camera
    viewport.fit()
    viewport.refresh()
    path = _temp_path(".png")
    if not viewport.saveAsImageFile(path, width, height):
        raise RuntimeError("Fusion could not save the image")
    return _read_and_remove(path)


def export(fmt):
    design = _design()
    manager = design.exportManager
    path = _temp_path("." + fmt)
    if fmt == "step":
        options = manager.createSTEPExportOptions(path)
    elif fmt == "iges":
        options = manager.createIGESExportOptions(path)
    elif fmt == "f3d":
        options = manager.createFusionArchiveExportOptions(path)
    elif fmt == "stl":
        options = manager.createSTLExportOptions(design.rootComponent, path)
    else:
        raise ValueError("unknown format " + fmt)
    if not manager.execute(options):
        raise RuntimeError("Fusion could not export " + fmt)
    return _read_and_remove(path)
