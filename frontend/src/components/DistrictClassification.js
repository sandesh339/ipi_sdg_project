import React, { useState, useMemo } from 'react';
import { Bar, Pie } from 'react-chartjs-2';
import Map, { Source, Layer } from 'react-map-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import IndicatorSelectionDropdown from './IndicatorSelectionDropdown';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend,
  ArcElement,
} from 'chart.js';

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend,
  ArcElement
);

const MAPBOX_TOKEN = "pk.eyJ1Ijoic2FuZGVzaDMzOSIsImEiOiJjbThqazJuaTYwaTlwMmtwdzU4NzUwN3YwIn0.Kc6gPcC0Jf2rSJN4ieeimA";

export default function DistrictClassification({ data = {}, boundary = [], chartOnly = false }) {
  const [viewState, setViewState] = useState({
    longitude: 78.96,
    latitude: 20.59,
    zoom: 3
  });
  const [selectedDistrict, setSelectedDistrict] = useState(null);
  const [chartType, setChartType] = useState("bar");
  const [currentIndicator, setCurrentIndicator] = useState(null);

  // Generate unique chart key to prevent canvas reuse issues
  const chartKey = useMemo(() => {
    const dataKey = JSON.stringify({ 
      chartType, 
      indicator: currentIndicator?.short_name,
      chartOnly 
    });
    return `classification-chart-${btoa(dataKey).slice(0, 10)}-${Date.now()}`;
  }, [chartType, currentIndicator, chartOnly]);

  // Extract classification data - handle both single indicator and multi-indicator structures
  const classificationData = useMemo(() => {
    // Handle function call results
    if (data && Array.isArray(data.data) && data.data.length > 0) {
      const firstResult = data.data[0];
      if ((firstResult.function === "get_sdg_goal_classification" || 
           firstResult.function === "get_aac_classification") && firstResult.result) {
        return firstResult.result;
      }
    }
    
    // Direct classification data
    if (data && data.success) {
      return data;
    }
    
    return null;
  }, [data]);

  // Check if this is a multi-indicator SDG goal classification
  const isMultiIndicatorClassification = useMemo(() => {
    return classificationData && 
           (classificationData.map_type === "sdg_goal_classification" ||
            classificationData.map_type === "aac_classification") &&
           classificationData.available_indicators &&
           classificationData.indicator_data_map;
  }, [classificationData]);

  // Get available indicators for dropdown
  const availableIndicators = useMemo(() => {
    if (isMultiIndicatorClassification) {
      return classificationData.available_indicators || [];
    }
    return [];
  }, [isMultiIndicatorClassification, classificationData]);

  // Get current indicator data
  const currentIndicatorData = useMemo(() => {
    if (!isMultiIndicatorClassification) {
      return classificationData;
    }

    const indicatorKey = currentIndicator?.short_name || classificationData?.default_indicator;
    if (indicatorKey && classificationData?.indicator_data_map?.[indicatorKey]) {
      const indicatorData = classificationData.indicator_data_map[indicatorKey];
      return {
        ...classificationData,
        indicator_name: indicatorData.indicator_name,
        indicator_full_name: indicatorData.indicator_full_name,
        data: indicatorData.data,
        classification_summary: indicatorData.classification_summary,
        total_districts: indicatorData.total_districts,
        thresholds: indicatorData.thresholds
      };
    }

    return classificationData;
  }, [isMultiIndicatorClassification, currentIndicator, classificationData]);

  // Initialize current indicator
  React.useEffect(() => {
    if (isMultiIndicatorClassification && availableIndicators.length > 0 && !currentIndicator) {
      const defaultIndicator = availableIndicators.find(ind => 
        ind.short_name === classificationData?.default_indicator
      ) || availableIndicators[0];
      setCurrentIndicator(defaultIndicator);
    }
  }, [isMultiIndicatorClassification, availableIndicators, currentIndicator, classificationData]);

  // Handle indicator selection
  const handleIndicatorChange = (indicator) => {
    setCurrentIndicator(indicator);
    setSelectedDistrict(null); // Clear selected district when changing indicator
  };

  // Cleanup effect for chart instances
  React.useEffect(() => {
    return () => {
      // Cleanup any existing chart instances
      const charts = ChartJS.instances;
      Object.keys(charts).forEach(key => {
        const chart = charts[key];
        if (chart && typeof chart.destroy === 'function') {
          chart.destroy();
        }
      });
    };
  }, []);

  // Process boundaries for map visualization
  const mapFeatures = useMemo(() => {
    if (!currentIndicatorData || !boundary || boundary.length === 0) {
      return [];
    }

    const districts = currentIndicatorData.data || [];
    const features = [];

    districts.forEach((district) => {
      const districtName = district.district;
      
      // Find matching boundary
      const boundaryEntry = boundary.find(
        b => b.district && b.district.toLowerCase() === districtName?.toLowerCase()
      );

      if (boundaryEntry && boundaryEntry.geometry) {
        features.push({
          type: "Feature",
          geometry: boundaryEntry.geometry,
          properties: {
            district_name: districtName,
            state_name: district.state,
            category: district.category,
            color: district.color,
            indicator_value: district.indicator_value,
            level: district.level,
            // Add AAC-related properties
            annual_change: district.annual_change,
            change_interpretation: district.change_interpretation,
            direction: district.direction,
            higher_is_better: district.higher_is_better,
            nfhs_4_value: district.nfhs_4_value,
            nfhs_5_value: district.nfhs_5_value
          }
        });
      }
    });

    return features;
  }, [currentIndicatorData, boundary]);

  // Prepare chart data for classification
  const chartData = useMemo(() => {
    if (!currentIndicatorData || !currentIndicatorData.classification_summary) {
      return {
        labels: ['No Data'],
        datasets: [{
          label: 'No Classification Data',
          data: [1],
          backgroundColor: ['#cccccc']
        }]
      };
    }

    const summary = currentIndicatorData.classification_summary;
    
    // Define different category orders based on classification type
    let categoryOrder;
    if (classificationData?.classification_type === "aac") {
      // For AAC classification, order from best to worst improvement
      categoryOrder = ['Rapidly Improving', 'Improving', 'Slowly Improving', 'Declining', 'Worsening', 'No Data'];
    } else {
      // For SDG status classification
      categoryOrder = ['Achieved-I', 'Achieved-II', 'On-Target', 'Off-Target', 'Unknown'];
    }
    
    // Sort categories according to the defined order
    const sortedEntries = Object.entries(summary).sort(([a], [b]) => {
      const aIndex = categoryOrder.indexOf(a);
      const bIndex = categoryOrder.indexOf(b);
      return (aIndex === -1 ? 999 : aIndex) - (bIndex === -1 ? 999 : bIndex);
    });
    
    const labels = sortedEntries.map(([category]) => category);
    const counts = sortedEntries.map(([, info]) => info.count);
    const colors = sortedEntries.map(([, info]) => info.color);

    return {
      labels: labels,
      datasets: [{
        label: `Districts by ${currentIndicatorData.indicator_name}`,
        data: counts,
        backgroundColor: colors,
        borderColor: '#5d4e37',
        borderWidth: chartType === 'bar' ? 1 : 0,
        hoverBackgroundColor: colors.map(color => color + 'CC'), // Add transparency on hover
        hoverBorderColor: '#5d4e37',
        hoverBorderWidth: 2
      }]
    };
  }, [currentIndicatorData, chartType, classificationData]);

  const chartOptions = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { 
        position: 'bottom',
        labels: { 
          padding: 20,
          usePointStyle: true,
          font: { size: 12 },
          generateLabels: (chart) => {
            // For pie charts, show custom labels with count
            if (chartType === 'pie') {
              const dataset = chart.data.datasets[0];
              return chart.data.labels.map((label, index) => ({
                text: `${label} (${dataset.data[index]})`,
                fillStyle: dataset.backgroundColor[index],
                strokeStyle: dataset.backgroundColor[index],
                lineWidth: 0,
                pointStyle: 'circle'
              }));
            }
            // For bar charts, use default behavior
            return ChartJS.defaults.plugins.legend.labels.generateLabels(chart);
          }
        }
      },
      title: {
        display: true,
        text: `District Classification: ${currentIndicatorData?.indicator_full_name || 'SDG Indicator'}`,
        font: { size: 16, weight: 'bold' },
        color: '#5d4e37'
      },
      tooltip: {
        callbacks: {
          label: function(context) {
            const label = context.label || '';
            const value = context.parsed.y !== undefined ? context.parsed.y : context.parsed;
            const total = context.dataset.data.reduce((a, b) => a + b, 0);
            const percentage = ((value / total) * 100).toFixed(1);
            
            // Add AAC range information for AAC classifications
            let rangeInfo = '';
            if (classificationData?.classification_type === "aac" && currentIndicatorData?.thresholds) {
              const thresholds = currentIndicatorData.thresholds;
              const isHigherBetter = currentIndicatorData?.higher_is_better;
              
              if (label === 'Rapidly Improving') {
                rangeInfo = isHigherBetter 
                  ? ` (AAC ≥ ${thresholds.q3?.toFixed(2)})`
                  : ` (AAC ≤ ${thresholds.q1?.toFixed(2)})`;
              } else if (label === 'Improving') {
                rangeInfo = isHigherBetter 
                  ? ` (${thresholds.q2?.toFixed(2)} ≤ AAC < ${thresholds.q3?.toFixed(2)})`
                  : ` (${thresholds.q1?.toFixed(2)} < AAC ≤ ${thresholds.q2?.toFixed(2)})`;
              } else if (label === 'Slowly Improving') {
                rangeInfo = isHigherBetter 
                  ? ` (${thresholds.q1?.toFixed(2)} ≤ AAC < ${thresholds.q2?.toFixed(2)})`
                  : ` (${thresholds.q2?.toFixed(2)} < AAC ≤ ${thresholds.q3?.toFixed(2)})`;
              } else if (label === 'Declining' || label === 'Worsening') {
                rangeInfo = isHigherBetter 
                  ? ` (AAC < ${thresholds.q1?.toFixed(2)})`
                  : ` (AAC > ${thresholds.q3?.toFixed(2)})`;
              }
            }
            
            return `${label}${rangeInfo}: ${value} districts (${percentage}%)`;
          },
          afterBody: function(context) {
            // Add explanation for AAC classifications
            if (classificationData?.classification_type === "aac") {
              const isHigherBetter = currentIndicatorData?.higher_is_better;
              const indicatorType = isHigherBetter ? 'coverage/positive indicators' : 'mortality/negative indicators';
              return [
                '',
                `Note: For ${indicatorType}:`,
                isHigherBetter 
                  ? '• Positive AAC = Improvement'
                  : '• Negative AAC = Improvement',
                '• AAC = Annual Average Change'
              ];
            }
            return [];
          }
        }
      }
    },
    scales: chartType === 'bar' ? {
      y: {
        beginAtZero: true,
        grid: { color: 'rgba(93, 78, 55, 0.1)' },
        ticks: { 
          color: '#5d4e37',
          stepSize: 1,
          callback: function(value) {
            return Math.floor(value) === value ? value : '';
          }
        },
        title: {
          display: true,
          text: 'Number of Districts',
          color: '#5d4e37',
          font: { size: 12, weight: 'bold' }
        }
      },
      x: {
        grid: { display: false },
        ticks: { 
          color: '#5d4e37',
          maxRotation: 45,
          minRotation: 0
        },
        title: {
          display: true,
          text: classificationData?.classification_type === "aac" 
            ? 'Annual Change Category' 
            : 'SDG Status Category',
          color: '#5d4e37',
          font: { size: 12, weight: 'bold' }
        }
      }
    } : {}
  }), [currentIndicatorData, chartType, classificationData]);

  const handleDistrictClick = (event) => {
    const feature = event.features?.[0];
    if (feature) {
      setSelectedDistrict(feature.properties);
    }
  };

  if (chartOnly) {
    return (
      <div style={{ 
        height: '500px', 
        width: '100%',
        padding: '20px',
        backgroundColor: '#faf9f7',
        borderRadius: '12px'
      }}>
        {/* Indicator Selection for Multi-Indicator Classification */}
        {isMultiIndicatorClassification && (
          <div style={{ marginBottom: '20px' }}>
            <IndicatorSelectionDropdown
              indicators={availableIndicators}
              selectedIndicator={currentIndicator}
              onSelectIndicator={handleIndicatorChange}
              title={`Select Indicator for SDG Goal ${classificationData?.sdg_goal} Classification`}
            />
          </div>
        )}

        <div style={{ 
          display: 'flex', 
          justifyContent: 'space-between', 
          alignItems: 'center',
          marginBottom: '20px'
        }}>
          <h3 style={{ margin: 0, color: '#5d4e37' }}>
            Classification Analysis
            {isMultiIndicatorClassification && currentIndicator && (
              <div style={{ fontSize: '14px', fontWeight: 'normal', color: '#8b7355', marginTop: '4px' }}>
                SDG Goal {classificationData?.sdg_goal} • {currentIndicator.short_name}
              </div>
            )}
          </h3>
          <div style={{ display: 'flex', gap: '10px' }}>
            <button
              onClick={() => setChartType('bar')}
              style={{
                padding: '8px 16px',
                backgroundColor: chartType === 'bar' ? '#8b7355' : '#f5f3f0',
                color: chartType === 'bar' ? 'white' : '#5d4e37',
                border: '1px solid #d4c4a8',
                borderRadius: '6px',
                cursor: 'pointer'
              }}
            >
              Bar Chart
            </button>
            <button
              onClick={() => setChartType('pie')}
              style={{
                padding: '8px 16px',
                backgroundColor: chartType === 'pie' ? '#8b7355' : '#f5f3f0',
                color: chartType === 'pie' ? 'white' : '#5d4e37',
                border: '1px solid #d4c4a8',
                borderRadius: '6px',
                cursor: 'pointer'
              }}
            >
              Pie Chart
            </button>
          </div>
        </div>
        
        <div style={{ height: isMultiIndicatorClassification ? '380px' : '450px', width: '100%' }}>
          {chartType === 'bar' ? (
            <Bar key={`${chartKey}-bar`} data={chartData} options={chartOptions} />
          ) : (
            <Pie key={`${chartKey}-pie`} data={chartData} options={chartOptions} />
          )}
        </div>

        {currentIndicatorData && (
          <div style={{ 
            marginTop: '20px',
            padding: '15px',
            backgroundColor: '#e8d5b7',
            borderRadius: '8px',
            fontSize: '14px',
            color: '#5d4e37'
          }}>
            <strong>Classification Summary:</strong> {currentIndicatorData.total_districts} districts classified 
            for {currentIndicatorData.indicator_full_name} ({classificationData?.year || 2021})
            {classificationData?.state_name && ` in ${classificationData.state_name}`}
            
            {/* AAC Range Explanation */}
            {classificationData?.classification_type === "aac" && currentIndicatorData?.thresholds && (
              <div style={{ marginTop: '12px', fontSize: '13px' }}>
                <strong>AAC (Annual Average Change) Ranges:</strong>
                <div style={{ marginTop: '8px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '8px' }}>
                  {(() => {
                    const thresholds = currentIndicatorData.thresholds;
                    const isHigherBetter = currentIndicatorData?.higher_is_better;
                    const categories = [];
                    
                    if (isHigherBetter) {
                      categories.push(
                        { name: 'Rapidly Improving', range: `AAC ≥ ${thresholds.q3?.toFixed(2)}`, color: '#1a5d1a' },
                        { name: 'Improving', range: `${thresholds.q2?.toFixed(2)} ≤ AAC < ${thresholds.q3?.toFixed(2)}`, color: '#2d8f2d' },
                        { name: 'Slowly Improving', range: `${thresholds.q1?.toFixed(2)} ≤ AAC < ${thresholds.q2?.toFixed(2)}`, color: '#ffa500' },
                        { name: 'Declining', range: `AAC < ${thresholds.q1?.toFixed(2)}`, color: '#d32f2f' }
                      );
                    } else {
                      categories.push(
                        { name: 'Rapidly Improving', range: `AAC ≤ ${thresholds.q1?.toFixed(2)}`, color: '#1a5d1a' },
                        { name: 'Improving', range: `${thresholds.q1?.toFixed(2)} < AAC ≤ ${thresholds.q2?.toFixed(2)}`, color: '#2d8f2d' },
                        { name: 'Slowly Improving', range: `${thresholds.q2?.toFixed(2)} < AAC ≤ ${thresholds.q3?.toFixed(2)}`, color: '#ffa500' },
                        { name: 'Worsening', range: `AAC > ${thresholds.q3?.toFixed(2)}`, color: '#d32f2f' }
                      );
                    }
                    
                    return categories.map((cat, index) => (
                      <div key={index} style={{ 
                        display: 'flex', 
                        alignItems: 'center', 
                        fontSize: '12px',
                        padding: '4px 8px',
                        backgroundColor: 'rgba(255,255,255,0.5)',
                        borderRadius: '4px'
                      }}>
                        <div style={{ 
                          width: '12px', 
                          height: '12px', 
                          backgroundColor: cat.color, 
                          marginRight: '8px',
                          borderRadius: '2px'
                        }}></div>
                        <span style={{ fontWeight: 'bold', marginRight: '6px' }}>{cat.name}:</span>
                        <span>{cat.range}</span>
                      </div>
                    ));
                  })()}
                </div>
                <div style={{ marginTop: '8px', fontSize: '11px', fontStyle: 'italic' }}>
                  Note: For {currentIndicatorData?.higher_is_better ? 'coverage/positive' : 'mortality/negative'} indicators, 
                  {currentIndicatorData?.higher_is_better ? ' positive' : ' negative'} AAC values indicate improvement.
                </div>
              </div>
            )}
            
            {isMultiIndicatorClassification && (
              <div style={{ marginTop: '8px', fontSize: '12px', fontStyle: 'italic' }}>
                {availableIndicators.length} indicators available for SDG Goal {classificationData?.sdg_goal}
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div style={{ 
      height: '100%', 
      width: '100%', 
      position: 'relative',
      borderRadius: '12px',
      overflow: 'hidden',
      border: '2px solid #d4c4a8',
      minHeight: '600px'
    }}>
      {/* Indicator Selection Overlay for Multi-Indicator Classification */}
      {isMultiIndicatorClassification && (
        <div style={{
          position: 'absolute',
          top: '10px',
          right: '10px',
          zIndex: 1000,
          width: '300px',
          background: 'rgba(255, 255, 255, 0.95)',
          padding: '15px',
          borderRadius: '8px',
          boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
          border: '2px solid #d4c4a8'
        }}>
          <IndicatorSelectionDropdown
            indicators={availableIndicators}
            selectedIndicator={currentIndicator}
            onSelectIndicator={handleIndicatorChange}
            title={`SDG Goal ${classificationData?.sdg_goal} Indicators`}
          />
        </div>
      )}

      <Map
        {...viewState}
        onMove={evt => setViewState(evt.viewState)}
        mapStyle="mapbox://styles/mapbox/light-v11"
        mapboxAccessToken={MAPBOX_TOKEN}
        interactiveLayerIds={['districts-fill']}
        onClick={handleDistrictClick}
      >
        <Source
          id="districts"
          type="geojson"
          data={{
            type: "FeatureCollection",
            features: mapFeatures
          }}
        >
          <Layer
            id="districts-fill"
            type="fill"
            paint={{
              'fill-color': ['get', 'color'],
              'fill-opacity': 0.7
            }}
          />
          <Layer
            id="districts-border"
            type="line"
            paint={{
              'line-color': '#5d4e37',
              'line-width': 1
            }}
          />
        </Source>

        {/* Classification Legend - Repositioned to avoid overlap */}
        {currentIndicatorData && currentIndicatorData.classification_summary && !selectedDistrict && (
          <div style={{
            position: 'absolute',
            bottom: '20px',
            left: '20px',
            right: '20px',
            background: 'rgba(255, 255, 255, 0.95)',
            padding: '12px',
            borderRadius: '8px',
            boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
            border: '2px solid #d4c4a8',
            zIndex: 999,
            maxHeight: '150px',
            overflowY: 'auto'
          }}>
            <h4 style={{ 
              margin: '0 0 8px 0', 
              color: '#5d4e37', 
              fontSize: '13px',
              fontWeight: 'bold',
              textAlign: 'center'
            }}>
              Classification Legend
            </h4>
            <div style={{
              display: 'flex',
              flexWrap: 'wrap',
              justifyContent: 'center',
              gap: '8px',
              alignItems: 'center'
            }}>
              {Object.entries(currentIndicatorData.classification_summary)
                .sort(([,a], [,b]) => {
                  // Sort by priority based on classification type
                  if (classificationData?.classification_type === "aac") {
                    const aacOrder = ['Rapidly Improving', 'Improving', 'Slowly Improving', 'Declining', 'Worsening', 'No Data'];
                    const aIndex = aacOrder.indexOf(a.category || a);
                    const bIndex = aacOrder.indexOf(b.category || b);
                    return (aIndex === -1 ? 999 : aIndex) - (bIndex === -1 ? 999 : bIndex);
                  } else {
                    const priority = {
                      'Achieved-I': 1, 'Achieved-II': 2, 'On-Target': 3, 
                      'Off-Target': 4, 'Unknown': 5
                    };
                    return (priority[a.category || a] || 6) - (priority[b.category || b] || 6);
                  }
                })
                .map(([category, info]) => (
                  <div key={category} style={{
                    display: 'flex',
                    alignItems: 'center',
                    fontSize: '11px',
                    whiteSpace: 'nowrap',
                    padding: '3px 6px',
                    backgroundColor: 'rgba(255,255,255,0.7)',
                    borderRadius: '4px'
                  }}>
                    <div style={{
                      width: '12px',
                      height: '12px',
                      backgroundColor: info.color,
                      borderRadius: '2px',
                      marginRight: '6px',
                      border: '1px solid rgba(93, 78, 55, 0.3)',
                      flexShrink: 0
                    }}></div>
                    <span style={{ 
                      color: '#5d4e37', 
                      fontWeight: '500',
                      lineHeight: '1.2'
                    }}>
                      {category} ({info.count})
                    </span>
                  </div>
                ))
              }
              <div style={{
                padding: '4px 8px',
                backgroundColor: 'rgba(139, 115, 85, 0.15)',
                borderRadius: '8px',
                fontSize: '10px',
                color: '#6d5a47',
                fontStyle: 'italic',
                fontWeight: '500'
              }}>
                Total: {currentIndicatorData.total_districts} districts
              </div>
            </div>
          </div>
        )}

        {selectedDistrict && (
          <div style={{
            position: 'absolute',
            top: '10px',
            left: '10px',
            background: 'rgba(255, 255, 255, 0.95)',
            padding: '15px',
            borderRadius: '8px',
            boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
            minWidth: '250px',
            maxWidth: '300px',
            maxHeight: 'calc(100vh - 100px)',
            overflowY: 'auto',
            border: '2px solid #d4c4a8'
          }}>
            <h4 style={{ margin: '0 0 10px 0', color: '#5d4e37' }}>
              {selectedDistrict.district_name}
            </h4>
            <p style={{ margin: '5px 0', color: '#6d5a47' }}>
              <strong>State:</strong> {selectedDistrict.state_name}
            </p>
            <p style={{ margin: '5px 0', color: '#6d5a47' }}>
              <strong>Category:</strong> {selectedDistrict.category}
            </p>
            
            {/* Show current indicator value */}
            <p style={{ margin: '5px 0', color: '#6d5a47' }}>
              <strong>Current Value ({classificationData?.year || 2021}):</strong> {selectedDistrict.indicator_value?.toFixed(2)}
            </p>
            
            {/* Show NFHS progression for context */}
            {selectedDistrict.nfhs_4_value !== undefined && selectedDistrict.nfhs_5_value !== undefined && (
              <>
                <p style={{ margin: '5px 0', color: '#6d5a47', fontSize: '12px' }}>
                  <strong>NFHS-4 (2016):</strong> {selectedDistrict.nfhs_4_value?.toFixed(2)}
                </p>
                <p style={{ margin: '5px 0', color: '#6d5a47', fontSize: '12px' }}>
                  <strong>NFHS-5 (2021):</strong> {selectedDistrict.nfhs_5_value?.toFixed(2)}
                </p>
              </>
            )}
            
            {/* AAC-specific information */}
            {classificationData?.classification_type === "aac" && selectedDistrict.annual_change !== undefined && (
              <>
                <div style={{ 
                  margin: '8px 0', 
                  padding: '8px',
                  backgroundColor: 'rgba(139, 115, 85, 0.1)',
                  borderRadius: '4px',
                  borderLeft: '3px solid #8b7355'
                }}>
                  <p style={{ margin: '2px 0', color: '#5d4e37', fontWeight: 'bold', fontSize: '13px' }}>
                    <strong>Annual Average Change (AAC):</strong> {selectedDistrict.annual_change?.toFixed(3)}
                  </p>
                  
                  {/* Show which range this AAC falls into */}
                  {currentIndicatorData?.thresholds && (
                    <p style={{ margin: '2px 0', color: '#6d5a47', fontSize: '11px', fontStyle: 'italic' }}>
                      {(() => {
                        const thresholds = currentIndicatorData.thresholds;
                        const aac = selectedDistrict.annual_change;
                        const isHigherBetter = selectedDistrict.higher_is_better;
                        
                        let rangeText = '';
                        if (isHigherBetter) {
                          if (aac >= thresholds.q3) rangeText = `Range: AAC ≥ ${thresholds.q3?.toFixed(2)} (Rapidly Improving)`;
                          else if (aac >= thresholds.q2) rangeText = `Range: ${thresholds.q2?.toFixed(2)} ≤ AAC < ${thresholds.q3?.toFixed(2)} (Improving)`;
                          else if (aac >= thresholds.q1) rangeText = `Range: ${thresholds.q1?.toFixed(2)} ≤ AAC < ${thresholds.q2?.toFixed(2)} (Slowly Improving)`;
                          else rangeText = `Range: AAC < ${thresholds.q1?.toFixed(2)} (Declining)`;
                        } else {
                          if (aac <= thresholds.q1) rangeText = `Range: AAC ≤ ${thresholds.q1?.toFixed(2)} (Rapidly Improving)`;
                          else if (aac <= thresholds.q2) rangeText = `Range: ${thresholds.q1?.toFixed(2)} < AAC ≤ ${thresholds.q2?.toFixed(2)} (Improving)`;
                          else if (aac <= thresholds.q3) rangeText = `Range: ${thresholds.q2?.toFixed(2)} < AAC ≤ ${thresholds.q3?.toFixed(2)} (Slowly Improving)`;
                          else rangeText = `Range: AAC > ${thresholds.q3?.toFixed(2)} (Worsening)`;
                        }
                        return rangeText;
                      })()}
                    </p>
                  )}
                </div>
              </>
            )}
            
            {/* Show change interpretation if available */}
            {selectedDistrict.change_interpretation && (
              <p style={{ 
                margin: '5px 0', 
                color: selectedDistrict.change_interpretation.is_improvement ? '#2d8f2d' : 
                       selectedDistrict.change_interpretation.is_improvement === false ? '#d32f2f' : '#6d5a47',
                fontSize: '13px',
                fontWeight: '500'
              }}>
                <strong>Trend:</strong> {selectedDistrict.change_interpretation.description}
              </p>
            )}
            
            {/* Show indicator direction info */}
            {selectedDistrict.direction && (
              <p style={{ 
                margin: '5px 0', 
                color: '#8b7355', 
                fontSize: '11px',
                fontStyle: 'italic',
                borderTop: '1px solid #e8d5b7',
                paddingTop: '8px'
              }}>
                <strong>Direction:</strong> {selectedDistrict.higher_is_better ? 'Higher is better' : 'Lower is better'}
                {classificationData?.classification_type === "aac" && (
                  <span> • {selectedDistrict.higher_is_better ? 'Positive' : 'Negative'} AAC = Improvement</span>
                )}
              </p>
            )}
            
            {isMultiIndicatorClassification && currentIndicator && (
              <p style={{ margin: '5px 0', color: '#6d5a47', fontSize: '12px' }}>
                <strong>Indicator:</strong> {currentIndicator.short_name}
              </p>
            )}
            <button
              onClick={() => setSelectedDistrict(null)}
              style={{
                marginTop: '10px',
                padding: '6px 12px',
                backgroundColor: '#8b7355',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer'
              }}
            >
              Close
            </button>
          </div>
        )}

        {/* Compact Legend when district is selected */}
        {currentIndicatorData && currentIndicatorData.classification_summary && selectedDistrict && (
          <div style={{
            position: 'absolute',
            bottom: '20px',
            left: '20px',
            background: 'rgba(255, 255, 255, 0.95)',
            padding: '8px',
            borderRadius: '6px',
            boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
            border: '1px solid #d4c4a8',
            zIndex: 999,
            maxWidth: '200px'
          }}>
            <div style={{ fontSize: '11px', fontWeight: 'bold', color: '#5d4e37', marginBottom: '4px' }}>
              Legend
            </div>
            <div style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: '4px'
            }}>
              {Object.entries(currentIndicatorData.classification_summary)
                .sort(([,a], [,b]) => {
                  if (classificationData?.classification_type === "aac") {
                    const aacOrder = ['Rapidly Improving', 'Improving', 'Slowly Improving', 'Declining', 'Worsening', 'No Data'];
                    const aIndex = aacOrder.indexOf(a.category || a);
                    const bIndex = aacOrder.indexOf(b.category || b);
                    return (aIndex === -1 ? 999 : aIndex) - (bIndex === -1 ? 999 : bIndex);
                  } else {
                    const priority = {
                      'Achieved-I': 1, 'Achieved-II': 2, 'On-Target': 3, 
                      'Off-Target': 4, 'Unknown': 5
                    };
                    return (priority[a.category || a] || 6) - (priority[b.category || b] || 6);
                  }
                })
                .map(([category, info]) => (
                  <div key={category} style={{
                    display: 'flex',
                    alignItems: 'center',
                    fontSize: '9px',
                    whiteSpace: 'nowrap'
                  }}>
                    <div style={{
                      width: '8px',
                      height: '8px',
                      backgroundColor: info.color,
                      borderRadius: '1px',
                      marginRight: '3px',
                      flexShrink: 0
                    }}></div>
                    <span style={{ color: '#5d4e37' }}>
                      {category.length > 12 ? category.substring(0, 12) + '...' : category}
                    </span>
                  </div>
                ))
              }
            </div>
          </div>
        )}
      </Map>

      {currentIndicatorData && (
        <div style={{
          position: 'absolute',
          bottom: '190px', // Moved up to avoid legend overlap
          right: '10px',
          background: 'rgba(255, 255, 255, 0.95)',
          padding: '10px',
          borderRadius: '8px',
          boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
          fontSize: '12px',
          color: '#5d4e37',
          border: '1px solid #d4c4a8',
          maxWidth: '250px'
        }}>
          <strong>{currentIndicatorData.indicator_full_name}</strong><br/>
          {currentIndicatorData.total_districts} districts • {classificationData?.year || 2021}
          {classificationData?.state_name && <><br/>{classificationData.state_name}</>}
          {isMultiIndicatorClassification && (
            <><br/>SDG Goal {classificationData?.sdg_goal}</>
          )}
        </div>
      )}
    </div>
  );
} 