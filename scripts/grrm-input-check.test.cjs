const assert = require("node:assert/strict");
const {readFileSync} = require("node:fs");
const path = require("node:path");
const {test} = require("node:test");
const check = require("../assets/grrm-input-check.js");
const samples = require("../_data/grrm_input_samples.json");

const water = "O 0 0 0\nH .758 0 .504\nH -.758 0 .504";
const input = (route, geometry = water) => route + "\n\n0 1\n" + geometry;
const problems = text => check(text).filter(issue => issue.severity !== "info");

test("sample templates encode line separators for GitHub Pages", () => {
  const page = readFileSync(path.join(__dirname, "../grrm-input-check.html"), "utf8");
  // GitHub Pages stripped the literal newlines emitted between sample lines.
  assert.match(page, /<code>[^<]*\{% unless forloop\.last %\}&#10;\{% endunless %\}[^<]*<\/code>/);
});

test("all published GRRM samples read their geometry without warnings", () => {
  assert.ok(samples.length > 1);
  for (const sample of samples) {
    const issues = check(sample.lines.join("\n"));
    assert.deepEqual(issues.filter(issue => issue.severity !== "info"), [], sample.label);
    assert.ok(issues.some(issue => issue.title === "座標ブロックを読み取りました"), sample.label);
  }
});

test("GRRM MIN accepts Cartesian geometry with no title and Gaussian settings in Options", () => {
  const text = input("# MIN/B3LYP/6-31G(d)") + "\nOptions\nGauMem=200\nGauProc=4";
  assert.deepEqual(problems("\uFEFF" + text.replaceAll("\n", "\r\n")), []);
  assert.deepEqual(problems(input("#MIN/B3LYP/6-31G(d)")), []);
});

test("Gaussian route, title card, Link 0 directives and Link1 get line-specific diagnostics", () => {
  const text = "%chk=water.chk\n%Mem=1GB\n%NProcShared=4\n#p B3LYP/6-31G(d) Opt\n\nWater optimization\n\n0 1\n" + water + "\n\n--Link1--";
  const issues = problems(text);
  assert.deepEqual(issues.map(issue => issue.line), [1, 2, 3, 4, 6, 13]);
  assert.ok(issues.every(issue => issue.severity === "error"));
  assert.match(issues[0].detail, /MO GUESS/);
  assert.match(issues[1].detail, /GauMem/);
  assert.match(issues[2].detail, /GauProc/);
  assert.match(issues[4].detail, /タイトルカード/);
  assert.match(issues[5].title, /--Link1--/);
});

test("GRRM % directives are accepted in the preamble and checked for value and placement", () => {
  const lup = "% water path\n%InFile = previous_PT0.log\n%link=siesta-3.1\n" + input("# LUP");
  assert.deepEqual(problems(lup), []);
  assert.deepEqual(problems(lup.replace("\n\n0 1", "\n0 1")), []);
  assert.match(problems(input("# LUP/B3LYP/6-31G"))[0].title, /%infile がありません/);
  assert.match(problems(lup.replace("previous_PT0.log", ""))[0].title, /%infile に値が必要/);
  assert.ok(problems(lup + "\nOptions\n%link=orca").some(issue => issue.line === 11 && /%link の位置/.test(issue.title)));
  assert.ok(problems(lup + "\nOptions\n%chk=wrong.chk").some(issue => /GaussianのLink 0/.test(issue.title)));
});

test("GRRM external interfaces accept method-free routes and require sublink for non-supported", () => {
  const text = "%link=non-supported\n" + input("# MIN") + "\nOptions\nNoFC\nsub link = ./grrm2xtb";
  assert.deepEqual(problems(text), []);
  assert.match(problems(text.replace(/\nsub link.*/, ""))[0].title, /sublink の指定がありません/);
  assert.deepEqual(problems("%link=gamess\n" + input("# MIN") + "\nOptions\nGmsProc=8"), []);
  const molpro = "%link=molpro2006\n" + input("# MIN") + "\nOptions\nMolpro Input\n{HF;}\nEND" +
    "\nStable=Opt\nBASIS=6-31G\n\n{HF;}\nEND";
  assert.deepEqual(problems(molpro), []);
});

test("AFIR diagnoses its own END and GAMMA while ignoring embedded program inputs", () => {
  const prefix = input("# SC-AFIR2/B3LYP/GenECP") + "\nOptions\n";
  const gauInput = "GauInpB\nO 0\n6-31G\n****\n\nH 0\nLANL2DZ\nEND";
  const interaction = "Add Interaction\nTarget = 1-2,3\nGAMMA = 100 set 0\nEND";
  assert.deepEqual(problems(prefix + interaction + "\n" + gauInput), []);
  assert.match(problems(prefix + interaction.replace(/\nEND$/, "") + "\n" + gauInput)[0].title, /Add Interaction の END/);
  assert.match(problems(prefix + gauInput)[0].title, /Add Interaction が見つかりません/);
  assert.match(problems(prefix + interaction.replace("set 0", "set -1"))[0].title, /GAMMA に負の値/);
  assert.match(problems(prefix + interaction.replace("100 set 0", "1.5bad"))[0].title, /GAMMA の値を読み取れません/);
  assert.match(problems(prefix + interaction.replace("GAMMA", "GANMA"))[0].title, /GAMMA の綴り/);
  const second = "\nSecond Input\nB3LYP/6-31G* TD(Singlets,Root=1)\n0 1\nEND";
  assert.deepEqual(problems(prefix + interaction + second), []);
});

test("part labels, frozen atoms, external atoms and TV vectors preserve atom references", () => {
  const geom = "O 0 0 0 H\nExternal Atoms\nH .7 0 0 L H 1\nFrozenAtoms\nH 0 .7 0 L\nTV 10 0 0";
  const text = input("# MC-AFIR/B3LYP/6-31G", geom) +
    "\nOptions\nNSample = 4\nAdd Interaction\nFragm.1 = 1-2,3\nFragm.2 = 2\n1 2\nGAMMA = 1D2\nEND" +
    "\nPriority Path\n1 3 plus\nEND";
  assert.deepEqual(problems(text), []);
  const invalid = problems(text.replace("1-2,3", "1-2,4").replace("1 3 plus", "1 4 plus"));
  assert.deepEqual(invalid.map(issue => issue.title), ["Fragm. の原子番号が範囲外です", "Priority Path の原子番号が範囲外です"]);
});

test("double-ended jobs compare endpoint atom order and do not require GAMMA", () => {
  const text = input("# DS-AFIR/B3LYP/6-31G", water + "\nReactant\n" + water);
  assert.deepEqual(problems(text), []);
  assert.match(problems(input("# DS-AFIR/B3LYP/6-31G"))[0].title, /Reactant の座標がありません/);
  assert.match(problems(text.replace("Reactant\nO", "Reactant\nH"))[0].title, /Reactant の原子数または元素順序/);
});

test("geometry, charge and multiplicity diagnostics respect section boundaries", () => {
  assert.match(problems("# MIN/HF/STO-3G\n\n0 2\nH 0 0 0\nH 0 0 1")[0].title, /偶奇/);
  assert.deepEqual(problems("# MIN/HF/STO-3G\n\n0 2\nH 0 0 0"), []);
  assert.deepEqual(problems("# MIN/HF/STO-3G\n\n1 1\nH 0 0 0"), []);
  assert.match(problems("# MIN/HF/STO-3G\n\n0 0\nH 0 0 0")[0].title, /多重度が不正/);
  assert.match(problems(input("# MIN/HF/STO-3G", "O\nH 1 .96\nH 1 .96 2 104.5"))[0].detail, /Z-matrix/);
  assert.match(problems(input("# MIN/HF/STO-3G") + "\n\nOptions\nGauProc=4")[0].title, /座標とOptionsの間に空行/);
  assert.match(problems(input("# MIN/HF/STO-3G") + "\nGauProc=4")[0].title, /Options 行がありません/);
  assert.match(problems(input("# MIN/HF/STO-3G") + "\nOptions\nGauProc=0")[0].title, /GauProc の値/);
});
