// 図の型の一覧。型を増やすときは、1ファイル追加してここに1行足す。
import flow from './flow.js';
import layers from './layers.js';
import sequence from './sequence.js';
import branch from './branch.js';
import tree from './tree.js';
import timeline from './timeline.js';
import compare from './compare.js';
import state from './state.js';
import swimlane from './swimlane.js';
import gitgraph from './gitgraph.js';
import zones from './zones.js';
import screenshot from './screenshot.js';
import bar from './bar.js';
import line from './line.js';
import stack from './stack.js';
import progress from './progress.js';
import scatter from './scatter.js';
import heatmap from './heatmap.js';
import sankey from './sankey.js';
import boxplot from './boxplot.js';
import treemap from './treemap.js';
import venn from './venn.js';
import gantt from './gantt.js';
import free from './free.js';

// 並び順は、図を選ぶときの優先順。実物の画面を先頭に、型のない自由な図を最後に置く。
export const types = { screenshot, flow, branch, swimlane, sequence, state, timeline, gantt, gitgraph, layers, tree, zones, compare, venn, bar, line, stack, progress, scatter, heatmap, sankey, boxplot, treemap, free };
