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
    viewer.addEventListener('click', onMouseDown);
    viewer.addEventListener('mousemove', onMouseMove);
    viewer.addEventListener('mouseup', onMouseUp);

    console.log("Molecule rendered");
}

function onMouseDown(event) {
    if (moveMode) {
        const atom = viewer.pickAtom({x: event.offsetX, y: event.offsetY});
        if (atom) {
            selectedAtom = atom;
            selectedAtom.style = {sphere: {scale: 0.5, color: 'red'}}; // 選択された原子の色を変更
            viewer.render();
            console.log("Selected atom:", selectedAtom);
        }
    }
}

function onMouseMove(event) {
    if (moveMode && selectedAtom) {
        const {model, index} = selectedAtom;
        const atom = model.selectedAtoms()[index];
        if (atom) {
            atom.x += event.movementX * 0.01; // 移動のスケーリングファクターを調整
            atom.y -= event.movementY * 0.01;
            model.updateAtomPositions();
            viewer.render();
        }
    }
}

function onMouseUp(event) {
    if (moveMode && selectedAtom) {
        selectedAtom.style = {sphere: {scale: 0.3}}; // 選択解除時のスタイルリセット
        viewer.render();
        selectedAtom = null;
    }
}
