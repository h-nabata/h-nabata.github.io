// Small synthetic structures; no research files.
const grrm='# DS-AFIR/B3LYP/6-31G\n\n0 1\nH 0 0 0\nH 0 0 .74\nReactant\nH 0 0 0\nH 0 0 1.4\nFrozen Atoms\nHe 5 0 0\nOptions\nReadCommonGeometry\nHe 5 0 0\nEND\n';
const gaussian='# HF/STO-3G\n\nsynthetic H2\n\n0 1\nH 0 0 0\nH 0 0 .74\n\n';
const orca='! HF STO-3G\n* xyz 0 1\nH 0 0 0\nH 0 0 .74\n*\n';
const xyz='2\nH2 fixture\nH 0 0 0\nH 0 0 .74\n';
const poscar='synthetic\n1\n4 0 0\n0 5 0\n0 0 6\nH\n2\nDirect\n0 0 0\n0 0 .1\n';
const gtable=(z='.740000')=>' Standard orientation:\n --------------------------------------\n Center Atomic Atomic Coordinates (Angstroms)\n Number Number Type X Y Z\n --------------------------------------\n 1 1 0 0.000000 0.000000 0.000000\n 2 1 0 0.000000 0.000000 '+z+'\n --------------------------------------\n';
const gro='synthetic GRO\n2\n    1MOL     H1    1   0.000   0.000   0.000\n    1MOL     H2    2   0.000   0.000   0.074\n   1.0 1.1 1.2\n';
module.exports={grrm,gaussian,orca,xyz,poscar,gtable,gro};
