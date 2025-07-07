import { useState, useEffect } from "react";

export default function IndicatorSelectionDropdown({ 
  indicators = [], 
  onSelectIndicator, 
  selectedIndicator = null,
  isLoading = false,
  title = "Select an Indicator"
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");

  // Filter indicators based on search term
  const filteredIndicators = indicators.filter(indicator =>
    indicator.full_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    indicator.short_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    indicator.indicator_number?.toString().includes(searchTerm)
  );

  const handleSelect = (indicator) => {
    onSelectIndicator(indicator);
    setIsOpen(false);
    setSearchTerm("");
  };

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (!event.target.closest('.indicator-dropdown')) {
        setIsOpen(false);
      }
    };

    document.addEventListener('click', handleClickOutside);
    return () => {
      document.removeEventListener('click', handleClickOutside);
    };
  }, []);

  if (isLoading) {
    return (
      <div style={{
        padding: '20px',
        textAlign: 'center',
        color: '#5d4e37',
        backgroundColor: 'rgba(212, 165, 116, 0.05)',
        borderRadius: '12px',
        border: '1px solid rgba(139, 115, 85, 0.2)'
      }}>
        <div style={{ 
          display: 'inline-block',
          width: '20px',
          height: '20px',
          border: '3px solid #d4a574',
          borderTop: '3px solid transparent',
          borderRadius: '50%',
          animation: 'spin 1s linear infinite',
          marginRight: '12px'
        }} />
        Loading indicators...
      </div>
    );
  }

  if (!indicators || indicators.length === 0) {
    return (
      <div style={{
        padding: '20px',
        textAlign: 'center',
        color: '#8b7355',
        backgroundColor: 'rgba(212, 165, 116, 0.05)',
        borderRadius: '12px',
        border: '1px solid rgba(139, 115, 85, 0.2)'
      }}>
        No indicators available for this SDG goal.
      </div>
    );
  }

  return (
    <div className="indicator-dropdown" style={{ position: 'relative', width: '100%' }}>
      <div style={{
        marginBottom: '12px',
        fontSize: '16px',
        fontWeight: '600',
        color: '#5d4e37'
      }}>
        {title}
      </div>
      
      {/* Selected indicator display */}
      {selectedIndicator && (
        <div style={{
          padding: '12px 16px',
          backgroundColor: 'rgba(212, 165, 116, 0.1)',
          borderRadius: '8px',
          border: '1px solid rgba(139, 115, 85, 0.3)',
          marginBottom: '12px',
          fontSize: '14px',
          color: '#5d4e37'
        }}>
          <strong>Selected:</strong> {selectedIndicator.full_name}
          <button
            onClick={() => onSelectIndicator(null)}
            style={{
              marginLeft: '12px',
              padding: '4px 8px',
              backgroundColor: '#d4a574',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              fontSize: '12px',
              cursor: 'pointer'
            }}
          >
            Change
          </button>
        </div>
      )}
      
      {/* Dropdown button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        style={{
          width: '100%',
          padding: '12px 16px',
          backgroundColor: 'white',
          border: '2px solid rgba(139, 115, 85, 0.2)',
          borderRadius: '8px',
          cursor: 'pointer',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          fontSize: '15px',
          color: '#5d4e37',
          transition: 'all 0.3s ease',
          outline: 'none'
        }}
        onMouseEnter={(e) => {
          e.target.style.borderColor = 'rgba(139, 115, 85, 0.4)';
          e.target.style.backgroundColor = 'rgba(212, 165, 116, 0.05)';
        }}
        onMouseLeave={(e) => {
          e.target.style.borderColor = 'rgba(139, 115, 85, 0.2)';
          e.target.style.backgroundColor = 'white';
        }}
      >
        <span>
          {selectedIndicator 
            ? `${selectedIndicator.indicator_number} - ${selectedIndicator.short_name}`
            : `Choose from ${indicators.length} available indicators`
          }
        </span>
        <span style={{ 
          transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)',
          transition: 'transform 0.3s ease'
        }}>
          ▼
        </span>
      </button>

      {/* Dropdown menu */}
      {isOpen && (
        <div style={{
          position: 'absolute',
          top: '100%',
          left: 0,
          right: 0,
          zIndex: 1000,
          backgroundColor: 'white',
          border: '2px solid rgba(139, 115, 85, 0.2)',
          borderRadius: '8px',
          boxShadow: '0 8px 24px rgba(139, 69, 19, 0.15)',
          marginTop: '4px',
          maxHeight: '300px',
          overflow: 'hidden'
        }}>
          {/* Search box */}
          <div style={{ padding: '12px', borderBottom: '1px solid rgba(139, 115, 85, 0.1)' }}>
            <input
              type="text"
              placeholder="Search indicators..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              style={{
                width: '100%',
                padding: '8px 12px',
                border: '1px solid rgba(139, 115, 85, 0.2)',
                borderRadius: '6px',
                fontSize: '14px',
                outline: 'none',
                boxSizing: 'border-box'
              }}
              autoFocus
            />
          </div>

          {/* Indicators list */}
          <div style={{ 
            maxHeight: '200px', 
            overflowY: 'auto',
            padding: '4px 0'
          }}>
            {filteredIndicators.length === 0 ? (
              <div style={{
                padding: '12px 16px',
                color: '#8b7355',
                fontSize: '14px',
                textAlign: 'center'
              }}>
                No indicators match your search
              </div>
            ) : (
              filteredIndicators.map((indicator, index) => (
                <button
                  key={indicator.short_name || index}
                  onClick={() => handleSelect(indicator)}
                  style={{
                    width: '100%',
                    padding: '10px 16px',
                    border: 'none',
                    backgroundColor: 'transparent',
                    textAlign: 'left',
                    cursor: 'pointer',
                    fontSize: '14px',
                    color: '#5d4e37',
                    transition: 'background-color 0.2s ease',
                    display: 'block'
                  }}
                  onMouseEnter={(e) => {
                    e.target.style.backgroundColor = 'rgba(212, 165, 116, 0.1)';
                  }}
                  onMouseLeave={(e) => {
                    e.target.style.backgroundColor = 'transparent';
                  }}
                >
                  <div style={{ fontWeight: '600', marginBottom: '2px' }}>
                    {indicator.indicator_number} - {indicator.short_name}
                  </div>
                  <div style={{ 
                    fontSize: '12px', 
                    color: '#8b7355',
                    lineHeight: '1.3'
                  }}>
                    {indicator.full_name}
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      )}
      
      {/* Add CSS animation for loading spinner */}
      <style jsx>{`
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
} 