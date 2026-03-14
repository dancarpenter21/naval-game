import { useState } from 'react';
import './Tabs.css';

const Tabs = ({ children }) => {
  const [activeTab, setActiveTab] = useState(0);

  return (
    <div className="tabs-container">
      <div className="tabs-header">
        {children.map((child, index) => (
          <button
            key={index}
            className={`tab-btn ${index === activeTab ? 'active' : ''}`}
            onClick={() => setActiveTab(index)}
          >
            {child.props.label}
          </button>
        ))}
      </div>
      <div className="tab-content">
        {children[activeTab]}
      </div>
    </div>
  );
};

export const Tab = ({ children }) => {
  return <div className="tab-pane">{children}</div>;
};

export default Tabs;
