function renderMolecule() {
    const xyzData = document.getElementById('xyz_input').value;
    const viewer = $3Dmol.createViewer("viewer", {
        defaultcolors: $3Dmol.rasmolElementColors
    });
    viewer.addModel(xyzData, "xyz");
    viewer.setStyle({}, {stick: {}});
    viewer.zoomTo();
    viewer.render();
}
