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
    const canvas = viewer.viewerDiv.querySelector('canvas');
    if (canvas) {
        canvas.addEventListener('mousedown', onMouseDown);
        canvas.addEventListener('mousemove', onMouseMove);
        canvas.addEventListener('mouseup', onMouseUp);
    }

    console.log("Molecule rendered");
}

function onMouseDown(event) {
    if (moveMode) {
        const rect = viewer.viewerDiv.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;
        const atom = viewer.pickAtom({x: x, y: y});
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
        const rect = viewer.viewerDiv.getBoundingClientRect();
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
