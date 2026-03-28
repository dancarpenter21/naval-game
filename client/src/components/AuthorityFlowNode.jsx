import { memo, useState } from 'react';
import { Handle, Position } from '@xyflow/react';

function initialsFromAuthority(node) {
  const raw = [node.name, node.title, node.role, node.id].find(Boolean) || '?';
  const words = String(raw)
    .split(/\s+/)
    .filter((w) => w.length > 0 && !/^(of|the|and|for)$/i.test(w));
  if (words.length >= 2) {
    return (words[0][0] + words[1][0]).toUpperCase();
  }
  const w = words[0] || raw;
  return w.slice(0, 2).toUpperCase();
}

function NodeAvatar({ node }) {
  const [broken, setBroken] = useState(false);
  const url = node.image_url && String(node.image_url).trim();
  if (url && !broken) {
    return (
      <img
        className="authority-flow-node__avatar authority-flow-node__avatar--img"
        src={url}
        alt=""
        loading="lazy"
        decoding="async"
        onError={() => setBroken(true)}
      />
    );
  }
  return (
    <div className="authority-flow-node__avatar authority-flow-node__avatar--fallback" aria-hidden>
      {initialsFromAuthority(node)}
    </div>
  );
}

function AuthorityFlowNode({ data }) {
  const node = data?.authority;
  if (!node) return null;

  const line1 = node.name || node.title || '';
  const line2 = node.name && node.title ? node.title : null;
  const tooltip = [node.role, node.jp_reference, node.notes].filter(Boolean).join('\n\n');

  return (
    <div className="authority-flow-node" data-authority-id={node.id} title={tooltip || undefined}>
      <Handle type="target" position={Position.Left} className="authority-flow-node__handle" />
      <div className="authority-flow-node__chrome">
        <div className="authority-flow-node__header">
          <span className="authority-flow-node__id">{node.id}</span>
          <NodeAvatar node={node} />
        </div>
        <div className="authority-flow-node__body">
          {line1 && <div className="authority-flow-node__line1">{line1}</div>}
          {line2 && <div className="authority-flow-node__line2">{line2}</div>}
          {node.role && <div className="authority-flow-node__role">{node.role}</div>}
        </div>
      </div>
      <Handle type="source" position={Position.Right} className="authority-flow-node__handle" />
    </div>
  );
}

export default memo(AuthorityFlowNode);
