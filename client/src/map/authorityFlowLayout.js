import dagre from 'dagre';
import { Position } from '@xyflow/react';

/** Match `AuthorityFlowNode` outer dimensions for Dagre. */
export const AUTHORITY_NODE_WIDTH = 238;
export const AUTHORITY_NODE_HEIGHT = 94;

/**
 * Flatten scenario authority roots into React Flow nodes + edges, then run Dagre (left → right).
 *
 * @param {object[]} roots
 * @returns {{ nodes: import('@xyflow/react').Node[], edges: import('@xyflow/react').Edge[] }}
 */
export function authorityTreeToFlow(roots) {
  const flat = [];
  const flowEdges = [];

  function visit(node, parentId) {
    flat.push({ id: node.id, authority: node });
    if (parentId) {
      flowEdges.push({
        id: `e:${parentId}->${node.id}`,
        source: parentId,
        target: node.id,
      });
    }
    const kids = Array.isArray(node.children) ? node.children : [];
    for (const c of kids) {
      visit(c, node.id);
    }
  }

  for (const r of roots) {
    visit(r, null);
  }

  const g = new dagre.graphlib.Graph().setDefaultEdgeLabel(() => ({}));
  g.setGraph({
    rankdir: 'LR',
    align: 'UL',
    nodesep: 26,
    ranksep: 52,
    marginx: 28,
    marginy: 28,
  });

  for (const n of flat) {
    g.setNode(n.id, { width: AUTHORITY_NODE_WIDTH, height: AUTHORITY_NODE_HEIGHT });
  }
  for (const e of flowEdges) {
    g.setEdge(e.source, e.target);
  }

  dagre.layout(g);

  const nodes = flat.map((n) => {
    const pos = g.node(n.id);
    return {
      id: n.id,
      type: 'authority',
      position: {
        x: pos.x - AUTHORITY_NODE_WIDTH / 2,
        y: pos.y - AUTHORITY_NODE_HEIGHT / 2,
      },
      // Required for XYFlow: nodeHasDimensions() only checks width/height/measured — not style alone.
      // Without these, wrappers stay visibility:hidden and nothing appears.
      width: AUTHORITY_NODE_WIDTH,
      height: AUTHORITY_NODE_HEIGHT,
      style: { width: AUTHORITY_NODE_WIDTH, height: AUTHORITY_NODE_HEIGHT },
      data: { authority: n.authority },
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
    };
  });

  return { nodes, edges: flowEdges };
}
