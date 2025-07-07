import { useState } from "react";
import IndicatorSelectionDropdown from "./IndicatorSelectionDropdown";

export default function IndicatorListDisplay({ 
  data = {}, 
  boundary = [], 
  chartOnly = false, 
  onIndicatorSelected = null 
}) {
  const [selectedIndicator, setSelectedIndicator] = useState(null);
  const [classificationMode, setClassificationMode] = useState(false);

  console.log("🎯 IndicatorListDisplay component rendered with props:", { data, chartOnly });

  // Process indicator data
  let indicatorData = null;
  
  console.log("=== INDICATOR LIST DISPLAY DEBUG ===");
  console.log("Raw data:", data);
  console.log("ChartOnly:", chartOnly);
  
  if (data && data.data && Array.isArray(data.data) && data.data.length > 0) {
    if (data.data[0].result) {
      indicatorData = data.data[0].result;
      console.log("Extracted nested result:", indicatorData);
    }
  } else if (data.indicators || data.sdg_goal) {
    indicatorData = data;
    console.log("Using direct data:", indicatorData);
  }

  const indicators = indicatorData?.indicators || [];
  const sdgGoal = indicatorData?.sdg_goal || data.sdg_goal;
  
  console.log("Final indicators:", indicators);
  console.log("Final SDG goal:", sdgGoal);

  const handleIndicatorSelect = (indicator) => {
    setSelectedIndicator(indicator);
    if (onIndicatorSelected) {
      onIndicatorSelected(indicator);
    }
  };

  const handleAnalyzeIndicator = () => {
    console.log("Analyze button clicked:", selectedIndicator, classificationMode);
    if (selectedIndicator && onIndicatorSelected) {
      // Trigger analysis with the selected indicator
      if (classificationMode) {
        onIndicatorSelected(selectedIndicator, "classification");
      } else {
        onIndicatorSelected(selectedIndicator, "analysis");
      }
    }
  };

  // Debug render - ensure something always renders
  if (!indicatorData && !sdgGoal && indicators.length === 0) {
    console.log("⚠️ NO DATA - rendering fallback");
    return (
      <div style={{
        width: '100%',
        minHeight: '400px',
        padding: '32px',
        backgroundColor: '#fff3cd',
        borderRadius: '16px',
        border: '1px solid #ffeaa7',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center'
      }}>
        <h3 style={{ color: '#8b7355', marginBottom: '16px' }}>
          🔍 No Indicator Data Found
        </h3>
        <p style={{ color: '#8b7355', textAlign: 'center', maxWidth: '400px' }}>
          Unable to load indicators for this request. Please try asking for a specific SDG goal number.
        </p>
        <div style={{ marginTop: '20px', fontSize: '14px', color: '#8b7355' }}>
          <strong>Debug Info:</strong><br/>
          Raw data keys: {Object.keys(data || {}).join(', ')}<br/>
          Indicators length: {indicators.length}<br/>
          SDG Goal: {sdgGoal || 'undefined'}
        </div>
      </div>
    );
  }

  if (chartOnly) {
    return (
      <div style={{ 
        width: '100%', 
        height: '600px', 
        padding: '20px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#faf9f7'
      }}>
        <h3 style={{ color: '#5d4e37', marginBottom: '20px' }}>
          SDG Goal {sdgGoal} Indicators
        </h3>
        <p style={{ color: '#8b7355', textAlign: 'center', maxWidth: '400px', marginBottom: '30px' }}>
          Please select a specific indicator to view chart data.
        </p>
        
        {/* Show indicator selection in chart modal too */}
        <div style={{ width: '100%', maxWidth: '500px' }}>
          <IndicatorSelectionDropdown
            indicators={indicators}
            onSelectIndicator={handleIndicatorSelect}
            selectedIndicator={selectedIndicator}
            title="Select an indicator to analyze:"
          />
          
          {selectedIndicator && (
            <div style={{ textAlign: 'center', marginTop: '20px' }}>
              <button
                onClick={handleAnalyzeIndicator}
                style={{
                  padding: '12px 24px',
                  background: 'linear-gradient(135deg, #d4a574 0%, #c19a6b 100%)',
                  color: 'white',
                  border: 'none',
                  borderRadius: '8px',
                  fontSize: '14px',
                  fontWeight: '600',
                  cursor: 'pointer',
                  boxShadow: '0 4px 16px rgba(212, 165, 116, 0.3)'
                }}
              >
                📊 Analyze {selectedIndicator.short_name}
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div style={{
      width: '100%',
      minHeight: '500px',
      padding: '32px',
      backgroundColor: '#faf9f7',
      borderRadius: '16px',
      border: '1px solid rgba(139, 115, 85, 0.12)'
    }}>
      {/* Header */}
      <div style={{
        textAlign: 'center',
        marginBottom: '32px'
      }}>
        <h2 style={{
          margin: '0 0 12px 0',
          fontSize: '28px',
          fontWeight: '700',
          color: '#5d4e37'
        }}>
          SDG Goal {sdgGoal} Indicators
        </h2>
        <p style={{
          margin: 0,
          fontSize: '16px',
          color: '#8b7355',
          lineHeight: '1.6'
        }}>
          {indicatorData?.message || `Found ${indicators.length} indicators for this SDG goal`}
        </p>
      </div>

      {/* Mode Selection */}
      <div style={{
        display: 'flex',
        justifyContent: 'center',
        marginBottom: '32px',
        gap: '16px'
      }}>
        <button
          onClick={() => setClassificationMode(false)}
          style={{
            padding: '12px 24px',
            borderRadius: '8px',
            border: classificationMode ? '2px solid rgba(139, 115, 85, 0.2)' : '2px solid #d4a574',
            backgroundColor: classificationMode ? 'white' : '#d4a574',
            color: classificationMode ? '#5d4e37' : 'white',
            fontSize: '15px',
            fontWeight: '600',
            cursor: 'pointer',
            transition: 'all 0.3s ease'
          }}
        >
          📊 Performance Analysis
        </button>
        <button
          onClick={() => setClassificationMode(true)}
          style={{
            padding: '12px 24px',
            borderRadius: '8px',
            border: classificationMode ? '2px solid #d4a574' : '2px solid rgba(139, 115, 85, 0.2)',
            backgroundColor: classificationMode ? '#d4a574' : 'white',
            color: classificationMode ? 'white' : '#5d4e37',
            fontSize: '15px',
            fontWeight: '600',
            cursor: 'pointer',
            transition: 'all 0.3s ease'
          }}
        >
          🗺️ District Classification
        </button>
      </div>

      {/* Mode Description */}
      <div style={{
        padding: '20px',
        backgroundColor: classificationMode ? 'rgba(212, 165, 116, 0.08)' : 'rgba(46, 204, 113, 0.08)',
        borderRadius: '12px',
        marginBottom: '32px',
        border: `1px solid ${classificationMode ? 'rgba(212, 165, 116, 0.2)' : 'rgba(46, 204, 113, 0.2)'}`
      }}>
        <h4 style={{
          margin: '0 0 8px 0',
          color: '#5d4e37',
          fontSize: '16px'
        }}>
          {classificationMode ? '🗺️ District Classification Mode' : '📊 Performance Analysis Mode'}
        </h4>
        <p style={{
          margin: 0,
          color: '#8b7355',
          fontSize: '14px',
          lineHeight: '1.5'
        }}>
          {classificationMode 
            ? 'Classify and visualize districts into performance categories (Excellent, Good, Fair, Needs Improvement) based on the selected indicator.'
            : 'Analyze top and bottom performing districts with detailed rankings and performance metrics for the selected indicator.'
          }
        </p>
      </div>

      {/* Indicator Selection */}
      <div style={{ marginBottom: '32px' }}>
        <IndicatorSelectionDropdown
          indicators={indicators}
          onSelectIndicator={handleIndicatorSelect}
          selectedIndicator={selectedIndicator}
          title={`Select an indicator for ${classificationMode ? 'classification' : 'analysis'}:`}
        />
      </div>

      {/* Action Button */}
      {selectedIndicator && (
        <div style={{ textAlign: 'center' }}>
          <button
            onClick={handleAnalyzeIndicator}
            style={{
              padding: '16px 32px',
              backgroundColor: 'linear-gradient(135deg, #d4a574 0%, #c19a6b 100%)',
              background: 'linear-gradient(135deg, #d4a574 0%, #c19a6b 100%)',
              color: 'white',
              border: 'none',
              borderRadius: '12px',
              fontSize: '16px',
              fontWeight: '600',
              cursor: 'pointer',
              boxShadow: '0 4px 16px rgba(212, 165, 116, 0.3)',
              transition: 'all 0.3s ease',
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              margin: '0 auto'
            }}
            onMouseEnter={(e) => {
              e.target.style.transform = 'translateY(-2px)';
              e.target.style.boxShadow = '0 6px 20px rgba(212, 165, 116, 0.4)';
            }}
            onMouseLeave={(e) => {
              e.target.style.transform = 'translateY(0)';
              e.target.style.boxShadow = '0 4px 16px rgba(212, 165, 116, 0.3)';
            }}
          >
            {classificationMode ? '🗺️ Classify Districts' : '📊 Analyze Performance'}
            <span style={{ fontSize: '14px', opacity: 0.9 }}>→</span>
          </button>
          
          <p style={{
            marginTop: '16px',
            fontSize: '14px',
            color: '#8b7355',
            fontStyle: 'italic'
          }}>
            This will {classificationMode ? 'create a district classification map' : 'show performance rankings and charts'} for: <strong>{selectedIndicator.short_name}</strong>
          </p>
        </div>
      )}

      {/* Indicators Grid Preview */}
      {indicators.length > 0 && (
        <div style={{ marginTop: '40px' }}>
          <h4 style={{
            margin: '0 0 20px 0',
            color: '#5d4e37',
            fontSize: '18px',
            textAlign: 'center'
          }}>
            Available Indicators ({indicators.length})
          </h4>
          
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
            gap: '16px',
            maxHeight: '300px',
            overflowY: 'auto'
          }}>
            {indicators.map((indicator, index) => (
              <div
                key={indicator.short_name || index}
                onClick={() => handleIndicatorSelect(indicator)}
                style={{
                  padding: '16px',
                  backgroundColor: selectedIndicator?.short_name === indicator.short_name 
                    ? 'rgba(212, 165, 116, 0.15)' 
                    : 'white',
                  borderRadius: '8px',
                  border: selectedIndicator?.short_name === indicator.short_name
                    ? '2px solid #d4a574'
                    : '1px solid rgba(139, 115, 85, 0.2)',
                  cursor: 'pointer',
                  transition: 'all 0.3s ease',
                  boxShadow: selectedIndicator?.short_name === indicator.short_name
                    ? '0 4px 12px rgba(212, 165, 116, 0.25)'
                    : '0 2px 8px rgba(139, 69, 19, 0.1)'
                }}
                onMouseEnter={(e) => {
                  if (selectedIndicator?.short_name !== indicator.short_name) {
                    e.target.style.borderColor = 'rgba(139, 115, 85, 0.4)';
                    e.target.style.backgroundColor = 'rgba(212, 165, 116, 0.05)';
                  }
                }}
                onMouseLeave={(e) => {
                  if (selectedIndicator?.short_name !== indicator.short_name) {
                    e.target.style.borderColor = 'rgba(139, 115, 85, 0.2)';
                    e.target.style.backgroundColor = 'white';
                  }
                }}
              >
                <div style={{
                  fontWeight: '600',
                  color: '#5d4e37',
                  marginBottom: '8px',
                  fontSize: '15px'
                }}>
                  {indicator.indicator_number} - {indicator.short_name}
                </div>
                <div style={{
                  fontSize: '13px',
                  color: '#8b7355',
                  lineHeight: '1.4'
                }}>
                  {indicator.full_name}
                </div>
                {selectedIndicator?.short_name === indicator.short_name && (
                  <div style={{
                    marginTop: '8px',
                    padding: '4px 8px',
                    backgroundColor: '#d4a574',
                    color: 'white',
                    borderRadius: '4px',
                    fontSize: '12px',
                    textAlign: 'center',
                    fontWeight: '500'
                  }}>
                    ✓ Selected
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
} 