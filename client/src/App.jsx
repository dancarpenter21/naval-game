import Tabs, { Tab } from './components/Tabs';
import MapView from './components/MapView';
import SyncMatrixView from './components/SyncMatrixView';
import './App.css';

function App() {
  return (
    <div className="App">
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
