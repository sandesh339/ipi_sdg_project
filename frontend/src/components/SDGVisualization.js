import React, { useState, useMemo } from 'react';
import { Bar, Pie } from 'react-chartjs-2';
import Map, { Source, Layer } from 'react-map-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import IndicatorListDisplay from './IndicatorListDisplay';
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
// Enhanced state colors for SDG data visualization
const STATE_COLORS = [
  "#E74C3C", "#3498DB", "#2ECC71", "#F39C12", "#9B59B6", 
  "#1ABC9C", "#E67E22", "#34495E", "#E91E63", "#00BCD4",
  "#F1C40F", "#8E44AD", "#E67E22", "#2C3E50", "#D35400"
];

export default function SDGVisualization({ data = {}, boundary = [], chartOnly = false, isModal = false }) {
  
  const [viewState, setViewState] = useState({
    longitude: 78.96,
    latitude: 20.59,
    zoom: 4.5
  });
  const [selectedDistrict, setSelectedDistrict] = useState(null);
  const [chartType, setChartType] = useState("bar");

  // Utility function to decode Unicode escape sequences
  const decodeUnicode = (str) => {
    if (!str || typeof str !== 'string') return str;
    return str.replace(/\\u([0-9a-fA-F]{4})/g, (match, grp) => {
      return String.fromCharCode(parseInt(grp, 16));
    });
  };

  // Check if this is an indicator list response that should use IndicatorListDisplay
  const isIndicatorListResponse = useMemo(() => {
    // Check if data.data is an array with function results
    if (data && Array.isArray(data.data) && data.data.length > 0) {
      const firstResult = data.data[0];
      
      // Check if it's a get_indicators_by_sdg_goal function call
      if (firstResult.function === "get_indicators_by_sdg_goal" && firstResult.result) {
        const result = firstResult.result;
        
        // Check if result has indicators array but no district data
        if (result.indicators && Array.isArray(result.indicators) && result.indicators.length > 0) {
          return true;
        }
      }
    }
    
    // Check direct structure for indicator list
    if (data && data.indicators && Array.isArray(data.indicators) && 
        data.indicators.length > 0 && data.sdg_goal && !data.district_data) {
      return true;
    }
    
    return false;
  }, [data]);

  // Handle different data structures from SDG backend
  const actualData = useMemo(() => {
    let processedData = data;
    
    // Handle case where data has top-level properties and nested data
    if (data && data.data && Array.isArray(data.data) && data.data.length > 0) {
      if (data.data[0].result) {
        // Extract the result from the first function call
        const result = data.data[0].result;
        
        // Merge top-level properties with result
        processedData = {
          ...data, // Keep top-level properties like sdg_goal, indicators, year, etc.
          data: result.data || result, // Use the actual data from result
          ...result // Merge any additional properties from result
        };
      }
    }
    // Handle array of function call results (fallback)
    else if (Array.isArray(data) && data.length > 0) {
      if (data[0].result) {
        processedData = data[0].result;
      }
    } else if (data.result) {
      processedData = data.result;
    }
    
    return processedData;
  }, [data]);

  // Determine analysis type and configure display accordingly
  const analysisConfig = useMemo(() => {
    const isSpecificIndicator = actualData?.analysis_type === "specific_indicator";
    const isOverallSDG = actualData?.analysis_type === "overall_sdg_goal";
    
    return {
      isSpecificIndicator,
      isOverallSDG,
      displayValueKey: isSpecificIndicator ? "indicator_value" : "performance_percentile",
      displayValueLabel: isSpecificIndicator ? "Indicator Value" : "Performance Percentile",
      displayValueSuffix: isSpecificIndicator ? "" : "%",
      chartTitle: isSpecificIndicator ? 
        (actualData?.indicator_full_name || actualData?.indicator_name || "Specific Indicator Analysis") :
        `SDG ${actualData?.sdg_goal} Overall Performance`,
      performanceNote: isSpecificIndicator ?
        (actualData?.higher_is_better ? 
          "Higher values indicate better performance" : 
          "Lower values indicate better performance") :
        "Higher percentiles indicate better overall SDG performance"
    };
  }, [actualData]);

  // Extract boundaries - prefer passed boundary parameter
  const boundaries = useMemo(() => {
    const processBoundaries = Array.isArray(boundary) && boundary.length
      ? boundary
      : (Array.isArray(data?.boundary) ? data.boundary : []);
      
    return processBoundaries;
  }, [boundary, data?.boundary]);

  // State color mapping and normalized features
  const { normalizedFeatures, stateColorMapping } = useMemo(() => {
    let features = [];
    let stateColors = {};
    
    if (!actualData?.data || boundaries.length === 0) {
      return { normalizedFeatures: features, stateColorMapping: stateColors };
    }

    let districtsData = [];
    
    // Handle different SDG data structures for trend/top/bottom queries
    if (Array.isArray(actualData.data)) {
      // Standard list of districts (top_performers, bottom_performers, individual)
      districtsData = actualData.data;
    } else if (actualData.data.combined_data || actualData.data.top_performers) {
      // Trend data with top_performers and bottom_performers
      const topDistricts = (actualData.data.top_performers || []).map(d => ({ ...d, category: "top" }));
      const bottomDistricts = (actualData.data.bottom_performers || []).map(d => ({ ...d, category: "bottom" }));
      districtsData = [...topDistricts, ...bottomDistricts];
    } else if (actualData.data.data && Array.isArray(actualData.data.data)) {
      // Handle nested data.data structure
      districtsData = actualData.data.data;
    }

    // Create state color mapping - ensure consistent ordering
    const uniqueStates = [...new Set(districtsData.map(d => d.state || d.state_name))].filter(Boolean).sort();
    uniqueStates.forEach((state, index) => {
      stateColors[state] = STATE_COLORS[index % STATE_COLORS.length];
    });

    // Map districts to features with boundaries
    districtsData.forEach((district, index) => {
      const districtName = district.district || district.district_name;
      const stateName = district.state || district.state_name;
      
      // Find matching boundary
      const boundaryEntry = boundaries.find(
        b => (b.district && b.district.toLowerCase() === districtName?.toLowerCase()) ||
             (b.district_name && b.district_name.toLowerCase() === districtName?.toLowerCase()) ||
             (b.geometry && b.geometry.properties && 
              b.geometry.properties.district_name?.toLowerCase() === districtName?.toLowerCase())
      );

      if (boundaryEntry) {
        const stateColor = stateColors[stateName] || STATE_COLORS[0];
        let fillColor = stateColor;
        
        // Apply transparency for bottom performers using rgba format
        if (district.category === "bottom") {
          // Convert hex to rgba with transparency
          const hex = stateColor.replace('#', '');
          const r = parseInt(hex.substr(0, 2), 16);
          const g = parseInt(hex.substr(2, 2), 16);
          const b = parseInt(hex.substr(4, 2), 16);
          fillColor = `rgba(${r}, ${g}, ${b}, 0.5)`;
        }

        // Get the indicator value for visualization based on analysis type
        const displayValue = analysisConfig.isSpecificIndicator ? 
          district.indicator_value : 
          district.performance_percentile;

        features.push({
          type: "Feature",
          geometry: boundaryEntry.geometry || boundaryEntry,
          properties: {
            district_name: districtName,
            state_name: stateName,
            display_value: displayValue || 0,
            indicator_value: district.indicator_value,
            performance_percentile: district.performance_percentile,
            trend_status: district.trend_status,
            is_improving: district.is_improving,
            rank: district.rank,
            category: district.category || "all",
            color: fillColor,
            aspirational_status: district.aspirational_status,
            district_sdg_status: district.district_sdg_status,
            indicators_count: district.indicators?.length || 0,
            annual_change: district.annual_change,
            trend_description: district.trend_description,
            overall_trend_analysis: district.overall_trend_analysis
          }
        });
      }
    });

    return { normalizedFeatures: features, stateColorMapping: stateColors };
  }, [actualData, boundaries, analysisConfig]);

  // Prepare chart data based on SDG data structure and analysis type
  const chartData = useMemo(() => {    
    if (!actualData?.data) {
      return {
        labels: ['Sample A', 'Sample B', 'Sample C'],
        datasets: [{
          label: 'Sample Data',
          data: [12, 19, 3],
          backgroundColor: STATE_COLORS.slice(0, 3),
          borderColor: '#5d4e37',
          borderWidth: 1
        }]
      };
    }

    let preparedChartData = { labels: [], datasets: [] };

    // Handle SDG-specific data structures
    if (Array.isArray(actualData.data)) {
      // Standard district list - add rank numbers to labels
      const labels = actualData.data.map((d, index) => {
        const rank = d.rank || (index + 1);
        const district = d.district || d.district_name || 'District';
        return `#${rank} ${district}`;
      });
      
      const values = actualData.data.map(d => {
        // Use the appropriate value based on analysis type
        return analysisConfig.isSpecificIndicator ? 
          (d.indicator_value || 0) : 
          (d.performance_percentile || 0);
      });
      
      const colors = actualData.data.map((d, i) => {
        const allStates = actualData.data.map(district => district.state || district.state_name || 'Unknown');
        const uniqueStates = [...new Set(allStates)];
        const stateIndex = uniqueStates.indexOf(d.state || d.state_name || 'Unknown');
        return STATE_COLORS[stateIndex % STATE_COLORS.length];
      });

      preparedChartData = {
        labels,
        datasets: [{
          label: analysisConfig.chartTitle,
          data: values,
          backgroundColor: colors,
          borderColor: '#5d4e37',
          borderWidth: 1
        }]
      };
    } else if (actualData.data.combined_data || actualData.data.top_performers) {
      // Trend data - combine top and bottom performers
      const topData = actualData.data.top_performers || [];
      const bottomData = actualData.data.bottom_performers || [];
      
      if (chartType === 'pie') {
        // For pie chart: show individual districts with their values but group legend by category
        const topValues = topData.map(d => analysisConfig.isSpecificIndicator ? 
          (d.indicator_value || 0) : (d.performance_percentile || 0));
        const bottomValues = bottomData.map(d => analysisConfig.isSpecificIndicator ? 
          (d.indicator_value || 0) : (d.performance_percentile || 0));
        
        // Create labels for individual slices but they won't show in legend
        const topLabels = topData.map((d, index) => `#${index + 1} ${d.district}`);
        const bottomLabels = bottomData.map((d, index) => `#${bottomData.length - index} ${d.district}`);
        
        preparedChartData = {
          labels: [...topLabels, ...bottomLabels],
          datasets: [{
            data: [...topValues, ...bottomValues],
            backgroundColor: [...Array(topData.length).fill('#2ECC71'), ...Array(bottomData.length).fill('#E74C3C')],
            borderColor: '#5d4e37',
            borderWidth: 1,
            // Custom legend labels to show only categories
            legendLabels: [
              `Top Performers (${topData.length} districts)`,
              `Bottom Performers (${bottomData.length} districts)`
            ],
            legendColors: ['#2ECC71', '#E74C3C']
          }]
        };
      } else {
        // For bar chart: show individual districts with rank numbers but group legend by category
        const topLabels = topData.map((d, index) => `#${index + 1} ${d.district}`);
        const topValues = topData.map(d => analysisConfig.isSpecificIndicator ? 
          (d.indicator_value || 0) : (d.performance_percentile || 0));
        const bottomLabels = bottomData.map((d, index) => `#${bottomData.length - index} ${d.district}`);
        const bottomValues = bottomData.map(d => analysisConfig.isSpecificIndicator ? 
          (d.indicator_value || 0) : (d.performance_percentile || 0));

        preparedChartData = {
          labels: [...topLabels, ...bottomLabels],
          datasets: [
            {
              label: `Top Performers (${topData.length} districts)`,
              data: [...topValues, ...Array(bottomData.length).fill(null)],
              backgroundColor: '#2ECC71',
              borderColor: '#5d4e37',
              borderWidth: 1
            },
            {
              label: `Bottom Performers (${bottomData.length} districts)`,
              data: [...Array(topData.length).fill(null), ...bottomValues],
              backgroundColor: '#E74C3C',
              borderColor: '#5d4e37',
              borderWidth: 1
            }
          ]
        };
      }
    }

    return preparedChartData;
  }, [actualData, chartType, analysisConfig]);

  const chartOptions = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: 'bottom',
        labels: { 
          padding: 20,
          usePointStyle: true,
          font: { size: 12 }
        }
      },
      title: {
        display: true,
        text: analysisConfig.chartTitle,
        font: { size: 16, weight: 'bold' },
        color: '#5d4e37'
      },
      tooltip: {
        callbacks: {
          label: function(context) {
            const label = context.label || '';
            const value = context.parsed.y !== undefined ? context.parsed.y : context.parsed;
            
            // Enhanced: Add appropriate value display with suffix
            let tooltipText = `${label}: ${typeof value === 'number' ? value.toFixed(2) : value}${analysisConfig.displayValueSuffix}`;
            
            // Try to find the district data with additional information
            let chartDataItem = null;
            
            // Check if actualData.data is an array before calling find
            if (Array.isArray(actualData?.data)) {
              chartDataItem = actualData.data.find(d => 
                d.district === label || 
                label.includes(d.district) ||
                d.label === label ||
                label.includes(d.district_name)
              );
            } else if (actualData?.data?.top_performers || actualData?.data?.bottom_performers) {
              // Handle case where data has top_performers and bottom_performers
              const allDistricts = [
                ...(actualData.data.top_performers || []),
                ...(actualData.data.bottom_performers || [])
              ];
              chartDataItem = allDistricts.find(d => 
                d.district === label || 
                label.includes(d.district) ||
                d.label === label ||
                label.includes(d.district_name)
              );
            }
            
            // Add complementary information based on analysis type
            if (chartDataItem) {
              if (analysisConfig.isSpecificIndicator && chartDataItem.performance_percentile !== undefined) {
                tooltipText += `\nPerformance Rank: ${chartDataItem.performance_percentile.toFixed(1)}th percentile`;
              } else if (analysisConfig.isOverallSDG && chartDataItem.indicator_value !== undefined) {
                tooltipText += `\nPrimary Indicator: ${chartDataItem.indicator_value.toFixed(2)}`;
              }
              
              // Add trend information if available
              if (chartDataItem.trend_description) {
                tooltipText += `\nTrend: ${chartDataItem.trend_description}`;
              } else if (chartDataItem.change_interpretation) {
                const changeInt = chartDataItem.change_interpretation;
                tooltipText += `\nTrend: ${changeInt.description}`;
              }
              
              if (chartDataItem.annual_change !== undefined) {
                tooltipText += `\nAnnual Change: ${chartDataItem.annual_change.toFixed(2)}`;
              }
            }
            
            return tooltipText.split('\n');
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
          callback: function(value) {
            return typeof value === 'number' ? 
              `${value.toFixed(1)}${analysisConfig.displayValueSuffix}` : value;
          }
        },
        title: {
          display: true,
          text: analysisConfig.displayValueLabel,
          color: '#5d4e37',
          font: { size: 12 }
        }
      },
      x: {
        grid: { color: 'rgba(93, 78, 55, 0.1)' },
        ticks: { 
          color: '#5d4e37',
          maxRotation: 45,
          minRotation: 0
        }
      }
    } : undefined
  }), [chartType, analysisConfig]);

  // Determine indicator name for chart header (must be before any early returns)
  const indicatorName = useMemo(() => {
    if (analysisConfig.isSpecificIndicator) {
      return actualData?.indicator_full_name || actualData?.indicator_name || "Specific Indicator";
    } else {
      return `SDG ${actualData?.sdg_goal || ''} Overall Performance`;
    }
  }, [actualData, analysisConfig]);

  const handleDistrictClick = (event) => {
    if (event.features && event.features.length > 0) {
      const feature = event.features[0];
      setSelectedDistrict(feature.properties);
    }
  };

  // Early return for indicator list display
  if (isIndicatorListResponse) {
    return <IndicatorListDisplay data={data} />;
  }

  // Chart-only view
  if (chartOnly) {
    return (
      <div style={{ 
        height: '100%', 
        width: '100%', 
        backgroundColor: '#f5f3f0',
        padding: '20px',
        borderRadius: '12px',
        border: '2px solid #d4c4a8'
      }}>
        <div style={{ 
          display: 'flex', 
          justifyContent: 'space-between', 
          alignItems: 'center',
          marginBottom: '20px'
        }}>
          <div>
            <h3 style={{ margin: 0, color: '#5d4e37', fontSize: '18px' }}>
              {indicatorName}
            </h3>
            <p style={{ margin: '4px 0 0 0', color: '#8b7355', fontSize: '14px' }}>
              {analysisConfig.isSpecificIndicator ? 
                `Specific Indicator Analysis • ${actualData?.year || 2021}` :
                `Overall SDG Performance • ${actualData?.year || 2021}`
              }
            </p>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              onClick={() => setChartType('bar')}
              style={{
                padding: '10px 12px',
                backgroundColor: chartType === 'bar' ? '#8b7355' : '#f5f3f0',
                color: chartType === 'bar' ? 'white' : '#5d4e37',
                border: '1px solid #d4c4a8',
                borderRadius: '8px',
                cursor: 'pointer',
                fontSize: '16px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'all 0.2s ease'
              }}
              title="Bar Chart"
            >
              📊
            </button>
            <button
              onClick={() => setChartType('pie')}
              style={{
                padding: '10px 12px',
                backgroundColor: chartType === 'pie' ? '#8b7355' : '#f5f3f0',
                color: chartType === 'pie' ? 'white' : '#5d4e37',
                border: '1px solid #d4c4a8',
                borderRadius: '8px',
                cursor: 'pointer',
                fontSize: '16px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'all 0.2s ease'
              }}
              title="Pie Chart"
            >
              🥧
            </button>
          </div>
        </div>
        
        <div style={{ height: '450px', width: '100%' }}>
          {chartType === 'bar' ? (
            <Bar data={chartData} options={chartOptions} />
          ) : (
            <Pie data={chartData} options={chartOptions} />
          )}
        </div>

        {actualData && (
          <div style={{ 
            marginTop: '20px',
            padding: '15px',
            backgroundColor: '#e8d5b7',
            borderRadius: '8px',
            fontSize: '14px',
            color: '#5d4e37'
          }}>
            <strong>Analysis Summary:</strong>
            {actualData.data && actualData.data.combined_data ? (
              <span>
                {` ${(actualData.data.top_performers || []).length} top performers vs ${(actualData.data.bottom_performers || []).length} bottom performers `}
                ({actualData.year || 2021})
              </span>
            ) : (
              <span>
                {` ${actualData.summary?.total_districts || actualData.data?.length || 'Multiple'} districts analyzed `}
                for {analysisConfig.isSpecificIndicator ? indicatorName : `SDG ${actualData?.sdg_goal} overall performance`} ({actualData.year || 2021})
              </span>
            )}
            <div style={{ marginTop: '8px', fontSize: '12px', fontStyle: 'italic' }}>
              {analysisConfig.performanceNote}
            </div>
            {analysisConfig.isSpecificIndicator && (
              <div style={{ marginTop: '4px', fontSize: '12px', fontStyle: 'italic', color: '#8b7355' }}>
                Chart shows actual indicator values • Performance percentiles available in tooltips
              </div>
            )}
            {analysisConfig.isOverallSDG && (
              <div style={{ marginTop: '4px', fontSize: '12px', fontStyle: 'italic', color: '#8b7355' }}>
                Chart shows performance percentiles across {actualData?.indicators?.length || 'multiple'} indicators
              </div>
            )}
            {chartType === 'pie' && actualData.data?.combined_data && (
              <div style={{ marginTop: '4px', fontSize: '12px', fontStyle: 'italic' }}>
                Pie chart colors: green (top performers), red (bottom performers)
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
      minHeight: '500px',
      width: '100%', 
      position: 'relative',
      borderRadius: '12px',
      overflow: 'hidden',
      border: '2px solid #d4c4a8'
    }}>
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
            features: normalizedFeatures
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

        {/* State Color Legend */}
        {Object.keys(stateColorMapping).length > 0 && (
          <div style={{
            position: 'absolute',
            top: '10px',
            right: '10px',
            background: 'rgba(255, 255, 255, 0.95)',
            padding: '15px',
            borderRadius: '8px',
            boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
            maxWidth: '200px',
            border: '2px solid #d4c4a8',
            maxHeight: '400px',
            overflowY: 'auto'
          }}>
            <h4 style={{ margin: '0 0 12px 0', color: '#5d4e37', fontSize: '14px' }}>
              States
            </h4>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {Object.entries(stateColorMapping).map(([state, color]) => (
                <div key={state} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <div style={{
                    width: '16px',
                    height: '16px',
                    backgroundColor: color,
                    borderRadius: '3px',
                    border: '1px solid #5d4e37',
                    flexShrink: 0
                  }} />
                  <span style={{ 
                    fontSize: '12px', 
                    color: '#5d4e37',
                    lineHeight: '1.2'
                  }}>
                    {state}
                  </span>
                </div>
              ))}
            </div>
            {actualData?.data?.top_performers && actualData?.data?.bottom_performers && (
              <div style={{ marginTop: '12px', paddingTop: '10px', borderTop: '1px solid #d4c4a8' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                  <div style={{
                    width: '16px',
                    height: '16px',
                    backgroundColor: 'rgba(128, 128, 128, 0.5)',
                    borderRadius: '3px',
                    border: '1px solid #5d4e37'
                  }} />
                  <span style={{ fontSize: '12px', color: '#5d4e37' }}>
                    Bottom Performers
                  </span>
                </div>
                <div style={{ fontSize: '11px', color: '#8b7355', fontStyle: 'italic' }}>
                  (Semi-transparent)
                </div>
              </div>
            )}
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
            maxWidth: '320px',
            border: '2px solid #d4c4a8'
          }}>
            <h4 style={{ margin: '0 0 10px 0', color: '#5d4e37' }}>
              {selectedDistrict.district_name}
            </h4>
            <p style={{ margin: '5px 0', color: '#6d5a47' }}>
              <strong>State:</strong> {selectedDistrict.state_name}
            </p>
            <p style={{ margin: '5px 0', color: '#6d5a47' }}>
              <strong>Rank:</strong> {selectedDistrict.rank}
            </p>
            
            {/* Display appropriate values based on analysis type */}
            {analysisConfig.isSpecificIndicator ? (
              <>
                <p style={{ margin: '5px 0', color: '#6d5a47' }}>
                  <strong>{analysisConfig.displayValueLabel}:</strong> {selectedDistrict.indicator_value?.toFixed(2) || 'N/A'}
                </p>
                {selectedDistrict.performance_percentile && (
                  <p style={{ margin: '5px 0', color: '#8b7355', fontSize: '12px' }}>
                    <strong>Performance Rank:</strong> {selectedDistrict.performance_percentile.toFixed(1)}th percentile
                  </p>
                )}
              </>
            ) : (
              <>
                <p style={{ margin: '5px 0', color: '#6d5a47' }}>
                  <strong>Performance Percentile:</strong> {selectedDistrict.performance_percentile?.toFixed(1) || 'N/A'}%
                </p>
                {selectedDistrict.indicator_value && (
                  <p style={{ margin: '5px 0', color: '#8b7355', fontSize: '12px' }}>
                    <strong>Primary Indicator:</strong> {selectedDistrict.indicator_value.toFixed(2)}
                  </p>
                )}
              </>
            )}
            
            {/* Enhanced trend display for overall SDG vs specific indicator */}
            {analysisConfig.isOverallSDG && selectedDistrict.overall_trend_analysis ? (
              <div style={{ margin: '8px 0', padding: '8px', backgroundColor: '#f8f6f3', borderRadius: '4px', fontSize: '12px' }}>
                <p style={{ margin: '2px 0', color: '#6d5a47' }}>
                  <strong>Overall Trend:</strong> {decodeUnicode(selectedDistrict.overall_trend_analysis.trend_icon)} {selectedDistrict.overall_trend_analysis.interpretation}
                </p>
                <p style={{ margin: '2px 0', color: '#8b7355', fontSize: '11px' }}>
                  {selectedDistrict.overall_trend_analysis.improvement_count} improving, {selectedDistrict.overall_trend_analysis.deterioration_count} declining
                  ({selectedDistrict.overall_trend_analysis.total_indicators} indicators)
                </p>
                {selectedDistrict.annual_change !== undefined && (
                  <p style={{ margin: '2px 0', color: '#6d5a47', fontSize: '11px' }}>
                    <strong>Avg Change:</strong> {selectedDistrict.annual_change.toFixed(2)}/year
                  </p>
                )}
              </div>
            ) : selectedDistrict.trend_status && (
              <>
                <p style={{ 
                  margin: '5px 0', 
                  color: selectedDistrict.is_improving ? '#2d8f2d' : '#d32f2f',
                  fontSize: '12px'
                }}>
                  <strong>Trend:</strong> {selectedDistrict.trend_status} 
                  {selectedDistrict.is_improving ? ' ↗️' : ' ↘️'}
                </p>
                {selectedDistrict.annual_change !== undefined && (
                  <p style={{ margin: '5px 0', color: '#6d5a47', fontSize: '12px' }}>
                    <strong>Annual Change:</strong> {selectedDistrict.annual_change.toFixed(2)}
                  </p>
                )}
              </>
            )}
            <p style={{ margin: '5px 0', color: '#6d5a47' }}>
              <strong>Category:</strong> {selectedDistrict.category === 'top' ? 'Top Performer' : 
                                           selectedDistrict.category === 'bottom' ? 'Bottom Performer' : 'All Districts'}
            </p>
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
      </Map>

      {/* Enhanced SDG Info - Bottom Left */}
      {actualData && (
        <div style={{
          position: 'absolute',
          bottom: '10px',
          left: '10px',
          background: 'rgba(255, 255, 255, 0.95)',
          padding: '8px 12px',
          borderRadius: '6px',
          boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
          fontSize: '12px',
          color: '#5d4e37',
          border: '1px solid #d4c4a8'
        }}>
          <strong>SDG {actualData.sdg_goal}</strong> • {actualData.year || 2021}
          {analysisConfig.isSpecificIndicator && (
            <div style={{ fontSize: '11px', fontStyle: 'italic', color: '#8b7355' }}>
              Specific Indicator Analysis
            </div>
          )}
          {analysisConfig.isOverallSDG && (
            <div style={{ fontSize: '11px', fontStyle: 'italic', color: '#8b7355' }}>
              Overall Performance ({actualData?.indicators?.length || 0} indicators)
            </div>
          )}
        </div>
      )}
    </div>
  );
} 