import React, { useState } from 'react';
import io from 'socket.io-client';
import Tabs, { Tab } from './components/Tabs';
import MapView from './components/MapView';
import SyncMatrixView from './components/SyncMatrixView';
import SessionModal from './components/SessionModal';
import './App.css';
import { SOCKET_PATH, SOCKET_URL } from './config';

const socket = SOCKET_URL
  ? io(SOCKET_URL, { path: SOCKET_PATH })
  : io({ path: SOCKET_PATH });

function App() {
  const [session, setSession] = useState(null);

  const handleSessionEstablished = (sessionData) => {
    setSession(sessionData);
  };

  return (
    <div className="App">
      {!session && <SessionModal socket={socket} onSessionEstablished={handleSessionEstablished} />}
      <Tabs>
        <Tab label="Map">
          <MapView />
        </Tab>
        <Tab label="Sync Matrix">
          <SyncMatrixView />
        </Tab>
      </Tabs>
    </div>
  );
}

export default App;
