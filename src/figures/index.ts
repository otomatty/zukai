// 図の型の一覧。型を増やすときは、1ファイル追加してここに1行足す。
import flow from './flow.ts';
import layers from './layers.ts';
import sequence from './sequence.ts';
import branch from './branch.ts';
import tree from './tree.ts';
import timeline from './timeline.ts';
import compare from './compare.ts';
import state from './state.ts';
import swimlane from './swimlane.ts';
import gitgraph from './gitgraph.ts';
import zones from './zones.ts';
import screenshot from './screenshot.ts';
import bar from './bar.ts';
import line from './line.ts';
import stack from './stack.ts';
import progress from './progress.ts';
import scatter from './scatter.ts';
import heatmap from './heatmap.ts';
import sankey from './sankey.ts';
import boxplot from './boxplot.ts';
import treemap from './treemap.ts';
import venn from './venn.ts';
import gantt from './gantt.ts';
import free from './free.ts';
import type { FigureTypes } from '../types.ts';

// 並び順は、図を選ぶときの優先順。実物の画面を先頭に、型のない自由な図を最後に置く。
export const types: FigureTypes = { screenshot, flow, branch, swimlane, sequence, state, timeline, gantt, gitgraph, layers, tree, zones, compare, venn, bar, line, stack, progress, scatter, heatmap, sankey, boxplot, treemap, free };
