"""Plot the native g-xTB asymmetric-band traces from benchmark_butadiene.py --json."""
import argparse
from itertools import groupby
import json
from pathlib import Path

import matplotlib as mpl
import matplotlib.pyplot as plt
from matplotlib.lines import Line2D
from matplotlib.patches import Patch
import numpy as np

METHODS = {'neb': 'NEB', 'cineb': 'CI-NEB', 'lup': 'CI-string'}
COLORS = {'dis': '#6ba9ce', 'con': '#e88934', 'unresolved': '#e2e6e8'}
TITLE = 'Terminal rotation during butadiene cyclization'
DESCRIPTION = ('Each row is a path image and each column is one evaluated iteration. Blue is '
               'disrotatory, orange conrotatory, and gray unresolved. The dark mark follows '
               'the highest-energy interior image. No values are drawn beyond the last checkpoint.')


def runs(values):
    start = 0
    for value, block in groupby(values):
        length = sum(1 for _ in block)
        yield value, start - .5, length
        start += length


def plot(rows, output):
    mpl.rcParams.update({'font.size': 9, 'svg.fonttype': 'none', 'svg.hashsalt': 'butadiene-trace'})
    fig, axes = plt.subplots(3, figsize=(9, 6.75))
    fig.subplots_adjust(left=.085, right=.97, bottom=.08, top=.775, hspace=.55)
    fig.text(.085, .95, TITLE, fontsize=17, weight='bold', color='#183144')
    fig.text(.085, .905, 'g-xTB  ·  Asymmetric disrotatory input  ·  Fixed endpoints  ·  No mirror constraint')
    handles = [Patch(color=COLORS[k], label=s) for k, s in zip(COLORS, ['Disrotatory', 'Conrotatory', 'Unresolved'])]
    handles.append(Line2D([], [], color='#172734', lw=1.3, label='Highest-energy interior image'))
    fig.legend(handles=handles, loc='center left', bbox_to_anchor=(.076, .854), ncol=4, frameon=False)
    limit = max(row['trace'][-1]['step'] for row in rows.values())
    for ax, (mode, label) in zip(axes, METHODS.items()):
        row = rows[mode]
        trace = row['trace']
        steps = [snapshot['step'] for snapshot in trace]
        if steps != list(range(steps[-1] + 1)) or steps[-1] != row['steps']:
            raise ValueError(f'{mode}: expected every fully evaluated iteration, including the last')
        classes = np.asarray([snapshot['imageClasses'] for snapshot in trace])
        for image, history in enumerate(classes.T, 1):
            for state, left, width in runs(history):
                ax.broken_barh([(left, width)], (image-.5, 1), facecolor=COLORS[state])
        ax.hlines(np.arange(1.5, classes.shape[1]), -.5, steps[-1]+.5, color='white', lw=.35, alpha=.7)
        for peak, left, width in runs(s['peakImage'] for s in trace):
            ax.hlines(peak, left, left+width, color='#172734', lw=1.3)
        ax.set(xlim=(-.5, limit+.5), ylim=(classes.shape[1]+.5, .5), ylabel='Image',
               yticks=range(1, classes.shape[1]+1), xticks=np.arange(0, steps[-1]+1, 25))
        ax.spines[:].set_visible(False)
        ax.tick_params(length=0, pad=3, labelsize=8)
        ax.set_title(label, loc='left', fontsize=12, weight='bold', color='#183144')
        end = 'last complete step before failure' if row['failure'] else 'iteration limit'
        ax.set_title(f'{end.capitalize()}  {steps[-1]}', loc='right', fontsize=9, color='#465867')
        if steps[-1] < limit:
            ax.set_xticks([*ax.get_xticks(), steps[-1]])
    axes[-1].set_xlabel('Relaxation iteration')
    fig.savefig(output, format='svg', metadata={'Date': None})
    plt.close(fig)
    svg = output.read_text().replace('<svg ', '<svg role="img" aria-labelledby="figure-title figure-desc" ', 1)
    svg = svg.replace('<metadata>', f'<title id="figure-title">{TITLE}</title>\n <desc id="figure-desc">{DESCRIPTION}</desc>\n <metadata>', 1)
    output.write_text("\n".join(line.rstrip() for line in svg.splitlines()) + "\n")


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('input', type=Path, nargs='+', help='Benchmark JSON files for the three methods')
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    rows = {row['mode']: row for source in args.input for row in json.loads(source.read_text())
            if row['case'] == 'free' and row['engine'] == 'gxtb' and row['endpointMode'] == 'fixed'}
    if set(rows) != set(METHODS) or len({r['inputSHA256'] for r in rows.values()}) != 1:
        parser.error('Provide free native g-xTB NEB, CI-NEB, and CI-string runs on the same input band')
    plot(rows, args.output)
