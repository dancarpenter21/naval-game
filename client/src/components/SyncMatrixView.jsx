import React from 'react';

const SyncMatrixView = () => {
  return (
    <div style={{ padding: '2rem', display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', flexDirection: 'column' }}>
      <h2 style={{ fontSize: '2rem', marginBottom: '1rem', color: '#61dafb' }}>Sync Matrix</h2>
      <p style={{ fontSize: '1.2rem', color: '#aaa', textAlign: 'center', maxWidth: '600px' }}>
        This page will contain the mission schedule allowing players to coordinate their actions.
        Future implementation will involve a timeline grid or a Gantt chart.
      </p>
    </div>
  );
};

export default SyncMatrixView;
