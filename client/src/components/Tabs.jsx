import { useState } from 'react';
import './Tabs.css';

const Tabs = ({ children, contentOverlay = null }) => {
  const [activeTab, setActiveTab] = useState(0);

  return (
    <div className="tabs-container">
      <div className="tabs-header">
        {children.map((child, index) => {
          const tabSlug = String(child.props.label ?? '')
            .toLowerCase()
            .trim()
            .replace(/\s+/g, '-');
          return (
            <button
              key={index}
              type="button"
              data-testid={`tab-${tabSlug}`}
              className={`tab-btn ${index === activeTab ? 'active' : ''}`}
              onClick={() => setActiveTab(index)}
            >
              {child.props.label}
            </button>
          );
        })}
      </div>
      <div className="tab-content">
        {contentOverlay}
        {children[activeTab]}
      </div>
    </div>
  );
};

export const Tab = ({ children }) => {
  return <div className="tab-pane">{children}</div>;
};

export default Tabs;
