import { useCallback, useEffect, useMemo } from 'react';
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import AuthorityFlowNode from './AuthorityFlowNode';
import { authorityTreeToFlow } from '../map/authorityFlowLayout';
import './AuthoritiesView.css';

const nodeTypes = { authority: AuthorityFlowNode };

/** Re-fit viewport when the scenario authority tree changes. */
function FitViewEffect({ layoutKey }) {
  const { fitView } = useReactFlow();
  useEffect(() => {
    const t = requestAnimationFrame(() => {
      fitView({ padding: 0.12, duration: 280 });
    });
    return () => cancelAnimationFrame(t);
  }, [layoutKey, fitView]);
  return null;
}

function AuthorityFlowCanvas({ roots }) {
  const { nodes: initialNodes, edges: initialEdges } = useMemo(
    () => authorityTreeToFlow(roots),
    [roots],
  );

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  useEffect(() => {
    setNodes(initialNodes);
    setEdges(initialEdges);
  }, [initialNodes, initialEdges, setNodes, setEdges]);

  const layoutKey = useMemo(
    () => initialNodes.map((n) => n.id).join('|'),
    [initialNodes],
  );

  const onInit = useCallback(
    (instance) => {
      instance.fitView({ padding: 0.12, duration: 0 });
    },
    [],
  );

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      nodeTypes={nodeTypes}
      onInit={onInit}
      colorMode="dark"
      nodesDraggable={false}
      nodesConnectable={false}
      elementsSelectable
      panOnScroll={false}
      zoomOnScroll
      zoomOnPinch
      minZoom={0.06}
      maxZoom={1.6}
      defaultEdgeOptions={{
        type: 'step',
        animated: false,
      }}
      className="authority-react-flow"
    >
      <FitViewEffect layoutKey={layoutKey} />
      <Background
        id="authority-flow-bg"
        variant={BackgroundVariant.Dots}
        gap={18}
        size={1}
        color="rgba(97, 218, 251, 0.09)"
      />
      <Controls className="authority-flow-controls" showInteractive={false} />
      <MiniMap
        className="authority-flow-minimap"
        pannable
        zoomable
        nodeStrokeWidth={2}
        maskColor="rgba(15, 23, 42, 0.88)"
      />
    </ReactFlow>
  );
}

function AuthorityFlowShell({ roots }) {
  return (
    <div className="authority-flow-host">
      <ReactFlowProvider>
        <AuthorityFlowCanvas roots={roots} />
      </ReactFlowProvider>
    </div>
  );
}

/**
 * Scenario-defined command & control authority tree (React Flow + Dagre, workbench-style).
 */
export default function AuthoritiesView({ authorities }) {
  const roots = Array.isArray(authorities) ? authorities : [];

  if (roots.length === 0) {
    return (
      <div className="authorities-view authorities-view--empty">
        <p className="authorities-view__empty-title">No authority chain for this scenario</p>
        <p className="authorities-view__empty-body">
          Add an <code>authorities</code> list to the scenario YAML to show national command, combatant
          commands, and joint-force relationships here.
        </p>
      </div>
    );
  }

  return (
    <div className="authorities-view">
      <header className="authorities-view__header">
        <h1 className="authorities-view__title">Command authorities</h1>
        <p className="authorities-view__lede">
          Notional U.S. joint relationships for this exercise (scenario data). For doctrine context see{' '}
          <a
            href="https://irp.fas.org/doddir/dod/jp3_0.pdf"
            target="_blank"
            rel="noopener noreferrer"
          >
            JP 3-0 — Joint Operations
          </a>
          . Drag the background to pan, scroll wheel to zoom; minimap and corner controls match typical workbench flows.
        </p>
      </header>
      <AuthorityFlowShell roots={roots} />
    </div>
  );
}
