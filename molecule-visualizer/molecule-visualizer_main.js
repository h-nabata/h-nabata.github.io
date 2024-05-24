let moveMode = false;
let selectedAtom = null;
let viewer;

function toggleMoveMode() {
    moveMode = !moveMode;
    console.log("Move mode:", moveMode);
}

function renderMolecule() {
    const xyzData = document.getElementById('xyz_input').value;
    viewer = $3Dmol.createViewer("viewer", {
        defaultcolors: $3Dmol.rasmolElementColors
    });
    viewer.addModel(xyzData, "xyz");
    viewer.setStyle({}, {
        stick: {radius: 0.2},
        sphere: {scale: 0.3}
    });
    viewer.zoomTo();
    viewer.render();

    // クリックイベントリスナを設定
    viewer.viewerDiv.addEventListener('mousedown', onMouseDown, false);
    viewer.viewerDiv.addEventListener('mousemove', onMouseMove, false);
    viewer.viewerDiv.addEventListener('mouseup', onMouseUp, false);
    
    console.log("Molecule rendered");
}

function onMouseDown(event) {
    if (moveMode) {
        const atom = viewer.pickAtom(event.pageX, event.pageY);
        if (atom) {
            selectedAtom = atom;
            console.log("Selected atom:", selectedAtom);
        }
    }
}

function onMouseMove(event) {
    if (moveMode && selectedAtom) {
        const {model, index} = selectedAtom;
        const atom = model.selectedAtoms()[index];
        if (atom) {
            atom.x += event.movementX * 0.01; // Adjust movement scaling factor as needed
            atom.y -= event.movementY * 0.01;
            model.updateAtomPositions();
            viewer.render();
        }
    }
}

function onMouseUp(event) {
    if (moveMode) {
        selectedAtom = null;
    }
}
