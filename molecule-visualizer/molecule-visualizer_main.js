let moveMode = false;
let selectedAtom = null;

function toggleMoveMode() {
    moveMode = !moveMode;
    console.log("Move mode:", moveMode);
}

function renderMolecule() {
    const xyzData = document.getElementById('xyz_input').value;
    const viewer = $3Dmol.createViewer("viewer", {
        defaultcolors: $3Dmol.rasmolElementColors
    });
    viewer.addModel(xyzData, "xyz");
    viewer.setStyle({}, {
        stick: {radius: 0.2},
        sphere: {scale: 0.3}
    });
    viewer.zoomTo();
    viewer.render();

    viewer.on('click', function(event, atom) {
        if (moveMode && atom) {
            selectedAtom = atom;
            console.log("Selected atom:", selectedAtom);
        }
    });

    viewer.on('mousemove', function(event) {
        if (moveMode && selectedAtom) {
            const xyz = viewer.selectedAtoms[0].xyz;
            xyz.x += event.dx / 100; // Adjust movement scaling factor as needed
            xyz.y += event.dy / 100;
            viewer.render();
        }
    });

    viewer.on('mouseup', function(event) {
        if (moveMode) {
            selectedAtom = null;
        }
    });

    console.log("Molecule rendered");
}
