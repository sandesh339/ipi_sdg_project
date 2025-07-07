import React, { useState, useMemo, useCallback } from 'react';
import { Bar, Line, Doughnut, Radar } from 'react-chartjs-2';
import Map, { Source, Layer, Popup } from 'react-map-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  LineElement,
  PointElement,
  Title,
  Tooltip,
  Legend,
  ArcElement,
  RadialLinearScale,
} from 'chart.js';

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  LineElement,
  PointElement,
  Title,
  Tooltip,
  Legend,
  ArcElement,
  RadialLinearScale
);

const MAPBOX_TOKEN = process.env.MAPBOX_TOKEN;

// Color schemes for different visualization types
const TARGET_COLOR = '#E74C3C';
const NEIGHBOR_COLORS = ['#3498DB', '#2ECC71', '#F39C12', '#9B59B6', '#1ABC9C', '#E67E22', '#34495E', '#E91E63', '#FF9800', '#4CAF50'];

const PERFORMANCE_COLORS = {
  excellent: '#2ECC71',
  good: '#27AE60',
  average: '#F39C12',
  poor: '#E74C3C',
  target: '#8E44AD'
};

export default function NeighboringDistrictsAnalysis({ data = {}, boundary = [], chartOnly = false, isModal = false, mapOnly = false }) {
  console.log('NeighboringDistrictsAnalysis received data:', data);

  const [viewState, setViewState] = useState({
    longitude: 78.96,
    latitude: 20.59,
    zoom: 6
  });
  const [chartType, setChartType] = useState("comparison"); // comparison, radar, ranking
  const [selectedIndicator, setSelectedIndicator] = useState(null);
  const [popupInfo, setPopupInfo] = useState(null);

  // Utility function to decode Unicode escape sequences
  const decodeUnicode = (str) => {
    if (!str || typeof str !== 'string') return str;
    return str.replace(/\\u([0-9a-fA-F]{4})/g, (match, grp) => {
      return String.fromCharCode(parseInt(grp, 16));
    });
  };

  // Extract the actual data from the nested structure
  const actualData = useMemo(() => {
    // If data has a 'data' property with function call results
    if (data?.data && Array.isArray(data.data) && data.data.length > 0 && data.data[0]?.result) {
      const result = data.data[0].result;
      return result;
    }
    
    // If data is the direct result
    if (data && typeof data === 'object') {
      return data;
    }
    
    return {};
  }, [data]);

  // Extract neighboring districts information
  const neighboringInfo = useMemo(() => {
    if (!actualData) return null;

    const targetDistrict = actualData.target_district;
    const neighbors = actualData.neighbors || [];
    const neighborMethod = actualData.neighbor_method || 'distance';
    const neighborCount = actualData.neighbor_count || 0;
    const analysis = actualData.analysis || '';
    const year = actualData.year || 2021;
    const sdgGoal = actualData.sdg_goal;
    const indicators = actualData.indicators;

    return {
      targetDistrict,
      neighbors,
      neighborMethod,
      neighborCount,
      analysis,
      year,
      sdgGoal,
      indicators,
      allDistricts: [targetDistrict, ...neighbors].filter(Boolean)
    };
  }, [actualData]);

  // Process boundary data for map visualization
  const mapFeatures = useMemo(() => {
    if (!neighboringInfo || !boundary || boundary.length === 0) return [];

    const features = [];
    const { targetDistrict, neighbors } = neighboringInfo;

    // Add target district feature
    if (targetDistrict?.district_name) {
      const targetBoundary = boundary.find(b => 
        b.district?.toLowerCase() === targetDistrict.district_name?.toLowerCase() ||
        b.district_name?.toLowerCase() === targetDistrict.district_name?.toLowerCase()
      );

      if (targetBoundary) {
        features.push({
          type: "Feature",
          geometry: targetBoundary.geometry || targetBoundary,
          properties: {
            district_name: targetDistrict.district_name,
            state_name: targetDistrict.state_name,
            fill_color: TARGET_COLOR,
            stroke_color: "#C0392B",
            district_type: "target",
            opacity: 0.8
          }
        });
      }
    }

    // Add neighbor features
    neighbors.forEach((neighbor, index) => {
      const neighborBoundary = boundary.find(b => 
        b.district?.toLowerCase() === neighbor.district_name?.toLowerCase() ||
        b.district_name?.toLowerCase() === neighbor.district_name?.toLowerCase()
      );

      if (neighborBoundary) {
        features.push({
          type: "Feature",
          geometry: neighborBoundary.geometry || neighborBoundary,
          properties: {
            district_name: neighbor.district_name,
            state_name: neighbor.state_name,
            fill_color: NEIGHBOR_COLORS[index % NEIGHBOR_COLORS.length],
            stroke_color: "#2C3E50",
            district_type: "neighbor",
            distance_km: neighbor.distance_km,
            opacity: 0.6
          }
        });
      }
    });

    return features;
  }, [neighboringInfo, boundary]);

  // Set initial map view to include all districts
  React.useEffect(() => {
    if (mapFeatures.length > 0) {
      // Calculate bounds for all districts
      let minLng = Infinity, maxLng = -Infinity;
      let minLat = Infinity, maxLat = -Infinity;

      mapFeatures.forEach(feature => {
        const extractCoordinates = (coords) => {
          if (Array.isArray(coords[0])) {
            coords.forEach(coord => extractCoordinates(coord));
          } else {
            const [lng, lat] = coords;
            minLng = Math.min(minLng, lng);
            maxLng = Math.max(maxLng, lng);
            minLat = Math.min(minLat, lat);
            maxLat = Math.max(maxLat, lat);
          }
        };

        if (feature.geometry && feature.geometry.coordinates) {
          extractCoordinates(feature.geometry.coordinates);
        }
      });

      if (minLng !== Infinity) {
        const centerLng = (minLng + maxLng) / 2;
        const centerLat = (minLat + maxLat) / 2;
        
        // Calculate appropriate zoom level
        const latDiff = maxLat - minLat;
        const lngDiff = maxLng - minLng;
        const maxDiff = Math.max(latDiff, lngDiff);
        
        let zoom = 8;
        if (maxDiff > 5) zoom = 6;
        else if (maxDiff > 3) zoom = 7;
        else if (maxDiff > 1) zoom = 8;
        else zoom = 9;
        
        setViewState(prev => ({
          ...prev,
          longitude: centerLng,
          latitude: centerLat,
          zoom: zoom
        }));
      }
    }
  }, [mapFeatures]);

  // Available indicators for selection
  const availableIndicators = useMemo(() => {
    const indicators = neighboringInfo?.targetDistrict?.performance?.indicators || [];
    console.log('Available indicators:', indicators);
    return indicators;
  }, [neighboringInfo]);

  // Set default selected indicator
  React.useEffect(() => {
    if (availableIndicators.length > 0 && !selectedIndicator) {
      setSelectedIndicator(availableIndicators[0].indicator_name);
    }
  }, [availableIndicators, selectedIndicator]);

  // Generate comparison chart data
  const generateComparisonChart = useCallback(() => {
    if (!neighboringInfo || !selectedIndicator) return null;

    const { targetDistrict, neighbors } = neighboringInfo;

    // Helper function to find indicator in either location
    const findIndicator = (district, indicatorName) => {
      return district?.performance?.indicators?.find(ind => ind.indicator_name === indicatorName) ||
             district?.indicators?.find(ind => ind.indicator_name === indicatorName);
    };

    // Find the selected indicator data for target district
    const targetIndicator = findIndicator(targetDistrict, selectedIndicator);
    
    if (!targetIndicator) {
      console.log('Target indicator not found:', selectedIndicator);
      console.log('Target district structure:', targetDistrict);
      console.log('Available indicators:', targetDistrict?.performance?.indicators);
      return null;
    }

    const labels = [targetDistrict.district_name, ...neighbors.map(n => n.district_name)];
    const values = [targetIndicator.performance_percentile || 0];
    const colors = [TARGET_COLOR];

    // Get neighbor values for the same indicator
    neighbors.forEach((neighbor, index) => {
      const neighborIndicator = findIndicator(neighbor, selectedIndicator);
      values.push(neighborIndicator?.performance_percentile || 0);
      colors.push(NEIGHBOR_COLORS[index % NEIGHBOR_COLORS.length]);
    });

    return {
      labels,
      datasets: [{
        label: 'Performance Percentile',
        data: values,
        backgroundColor: colors,
        borderColor: colors.map(color => color + 'CC'),
        borderWidth: 2,
        borderRadius: 4
      }]
    };
  }, [neighboringInfo, selectedIndicator]);

  // Generate radar chart data for multi-indicator comparison
  const generateRadarChart = useCallback(() => {
    if (!neighboringInfo || !availableIndicators.length) return null;

    const { targetDistrict, neighbors } = neighboringInfo;
    const indicatorNames = availableIndicators.slice(0, 6).map(ind => ind.indicator_name); // Limit to 6 for readability

    // Helper function to find indicator in either location
    const findIndicator = (district, indicatorName) => {
      return district?.performance?.indicators?.find(i => i.indicator_name === indicatorName) ||
             district?.indicators?.find(i => i.indicator_name === indicatorName);
    };

    const datasets = [];

    // Target district data
    const targetData = indicatorNames.map(indName => {
      const ind = findIndicator(targetDistrict, indName);
      return ind?.performance_percentile || 0;
    });

    datasets.push({
      label: targetDistrict?.district_name || 'Target',
      data: targetData,
      borderColor: TARGET_COLOR,
      backgroundColor: TARGET_COLOR + '20',
      pointBackgroundColor: TARGET_COLOR,
      pointBorderColor: TARGET_COLOR,
      pointHoverBackgroundColor: '#fff',
      pointHoverBorderColor: TARGET_COLOR,
      borderWidth: 3
    });

    // Add up to 3 neighbor datasets
    neighbors.slice(0, 3).forEach((neighbor, index) => {
      const neighborData = indicatorNames.map(indName => {
        const ind = findIndicator(neighbor, indName);
        return ind?.performance_percentile || 0;
      });

      const color = NEIGHBOR_COLORS[index];
      datasets.push({
        label: neighbor.district_name,
        data: neighborData,
        borderColor: color,
        backgroundColor: color + '20',
        pointBackgroundColor: color,
        pointBorderColor: color,
        pointHoverBackgroundColor: '#fff',
        pointHoverBorderColor: color,
        borderWidth: 2
      });
    });

    return {
      labels: indicatorNames.map(name => name.replace(/_/g, ' ').slice(0, 20) + '...'),
      datasets
    };
  }, [neighboringInfo, availableIndicators]);

  // Generate indicator comparison chart (grouped bar chart)
  const generateIndicatorComparisonChart = useCallback(() => {
    if (!neighboringInfo || !availableIndicators.length) return null;

    const { targetDistrict, neighbors } = neighboringInfo;
    const selectedNeighbors = neighbors.slice(0, 4); // Limit to top 4 neighbors for readability
    
    // Get indicator names (limit to 5 for better visualization)
    const indicatorNames = availableIndicators.slice(0, 5).map(ind => ind.indicator_full_name);
    
    // Helper function to find indicator in either location
    const findIndicatorByFullName = (district, fullName) => {
      return district?.performance?.indicators?.find(i => i.indicator_full_name === fullName) ||
             district?.indicators?.find(i => i.indicator_full_name === fullName);
    };
    
    const datasets = [];

    // Target district dataset
    const targetData = indicatorNames.map((fullName) => {
      const targetInd = findIndicatorByFullName(targetDistrict, fullName);
      return targetInd?.performance_percentile || 0;
    });

    datasets.push({
      label: targetDistrict?.district_name || 'Target District',
      data: targetData,
      backgroundColor: TARGET_COLOR,
      borderColor: TARGET_COLOR,
      borderWidth: 1,
      borderRadius: 4
    });

    // Neighbor datasets
    selectedNeighbors.forEach((neighbor, index) => {
      const neighborData = indicatorNames.map((fullName) => {
        const neighborInd = findIndicatorByFullName(neighbor, fullName);
        return neighborInd?.performance_percentile || 0;
      });

      const color = NEIGHBOR_COLORS[index % NEIGHBOR_COLORS.length];
      datasets.push({
        label: neighbor.district_name,
        data: neighborData,
        backgroundColor: color,
        borderColor: color,
        borderWidth: 1,
        borderRadius: 4
      });
    });

    return {
      labels: indicatorNames.map(name => {
        // Truncate long indicator names
        return name.length > 25 ? name.substring(0, 25) + '...' : name;
      }),
      datasets
    };
  }, [neighboringInfo, availableIndicators]);

  // Generate ranking chart
  const generateRankingChart = useCallback(() => {
    if (!neighboringInfo) return null;

    const { targetDistrict, neighbors } = neighboringInfo;
    const allDistricts = [targetDistrict, ...neighbors].filter(Boolean);

    // Calculate overall performance for each district
    const districtScores = allDistricts.map(district => {
      let performance = 0;
      
      // Try to get overall performance from different possible locations
      if (district.performance?.overall_performance !== undefined) {
        performance = district.performance.overall_performance;
      } else if (district.overall_performance !== undefined) {
        performance = district.overall_performance;
      } else {
        // Calculate from indicators if available
        const indicators = district.performance?.indicators || district.indicators || [];
        if (indicators.length > 0) {
          const validPercentiles = indicators
            .map(ind => ind.performance_percentile)
            .filter(p => p !== null && p !== undefined);
          performance = validPercentiles.length > 0 
            ? validPercentiles.reduce((sum, p) => sum + p, 0) / validPercentiles.length 
            : 0;
        }
      }
      
      return {
        name: district.district_name,
        performance,
        isTarget: district === targetDistrict
      };
    });

    // Sort by performance (descending)
    districtScores.sort((a, b) => b.performance - a.performance);

    const labels = districtScores.map(d => d.name);
    const values = districtScores.map(d => d.performance);
    const colors = districtScores.map(d => d.isTarget ? TARGET_COLOR : '#3498DB');

    return {
      labels,
      datasets: [{
        label: 'Overall Performance Percentile',
        data: values,
        backgroundColor: colors,
        borderColor: colors.map(color => color + 'CC'),
        borderWidth: 2,
        borderRadius: 4
      }]
    };
  }, [neighboringInfo]);

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: 'top',
        labels: {
          padding: 20,
          usePointStyle: true,
          font: {
            size: 12,
            weight: '500'
          }
        }
      },
      tooltip: {
        backgroundColor: 'rgba(0, 0, 0, 0.8)',
        titleColor: '#fff',
        bodyColor: '#fff',
        borderColor: '#ddd',
        borderWidth: 1,
        cornerRadius: 8,
        displayColors: true,
        callbacks: {
          afterLabel: function(context) {
            if (chartType === 'comparison' && neighboringInfo) {
              const district = context.label;
              const neighbor = neighboringInfo.neighbors.find(n => n.district_name === district);
              if (neighbor?.distance_km) {
                return `Distance: ${neighbor.distance_km} km`;
              }
            }
            return '';
          }
        }
      }
    },
    scales: chartType !== 'radar' ? {
      y: {
        beginAtZero: true,
        max: 100,
        grid: {
          color: 'rgba(0, 0, 0, 0.1)'
        },
        ticks: {
          font: {
            size: 11
          }
        }
      },
      x: {
        grid: {
          display: false
        },
        ticks: {
          font: {
            size: 11
          },
          maxRotation: 45
        }
      }
    } : {
      r: {
        beginAtZero: true,
        max: 100,
        ticks: {
          stepSize: 20,
          font: {
            size: 10
          }
        },
        grid: {
          color: 'rgba(0, 0, 0, 0.1)'
        }
      }
    }
  };

  const renderAnalysisText = () => {
    if (!neighboringInfo?.analysis) return null;

    const analysisText = decodeUnicode(neighboringInfo.analysis);
    
    return (
      <div style={{
        background: 'linear-gradient(135deg, #f8f9fa 0%, #e9ecef 100%)',
        border: '1px solid #dee2e6',
        borderRadius: '12px',
        padding: '20px',
        margin: '20px 0',
        boxShadow: '0 2px 8px rgba(0,0,0,0.08)'
      }}>
        <h4 style={{
          color: '#495057',
          marginBottom: '15px',
          fontSize: '16px',
          fontWeight: '600',
          borderBottom: '2px solid #E74C3C',
          paddingBottom: '8px',
          display: 'inline-block'
        }}>
          📊 Comparative Analysis
        </h4>
        <div style={{
          lineHeight: '1.6',
          color: '#495057',
          fontSize: '14px',
          whiteSpace: 'pre-line'
        }}>
          {analysisText}
        </div>
      </div>
    );
  };

  const renderDistrictSummary = () => {
    if (!neighboringInfo) return null;

    const { targetDistrict, neighbors, neighborMethod, neighborCount } = neighboringInfo;

    return (
      <div style={{
        background: 'linear-gradient(135deg, #ffffff 0%, #f8f9fa 100%)',
        border: '1px solid #dee2e6',
        borderRadius: '12px',
        padding: '20px',
        margin: '20px 0',
        boxShadow: '0 2px 8px rgba(0,0,0,0.08)'
      }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          marginBottom: '15px'
        }}>
          <h3 style={{
            color: '#E74C3C',
            fontSize: '18px',
            fontWeight: '600',
            margin: 0,
            marginRight: '15px'
          }}>
            📍 {targetDistrict?.district_name}, {targetDistrict?.state_name}
          </h3>
          <span style={{
            background: 'linear-gradient(135deg, #E74C3C 0%, #C0392B 100%)',
            color: 'white',
            padding: '4px 12px',
            borderRadius: '20px',
            fontSize: '12px',
            fontWeight: '500'
          }}>
            TARGET DISTRICT
          </span>
        </div>

        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: '15px',
          marginBottom: '15px'
        }}>
          <div>
            <strong style={{ color: '#495057' }}>Neighbors Found:</strong>
            <span style={{ marginLeft: '8px', color: '#6c757d' }}>{neighborCount}</span>
          </div>
          <div>
            <strong style={{ color: '#495057' }}>Method:</strong>
            <span style={{ 
              marginLeft: '8px', 
              color: '#6c757d',
              textTransform: 'capitalize'
            }}>
              {neighborMethod.replace('_', ' ')}
            </span>
          </div>
          <div>
            <strong style={{ color: '#495057' }}>Analysis Year:</strong>
            <span style={{ marginLeft: '8px', color: '#6c757d' }}>{neighboringInfo.year}</span>
          </div>
        </div>

        <div>
          <h4 style={{
            color: '#495057',
            fontSize: '16px',
            fontWeight: '600',
            marginBottom: '10px',
            borderBottom: '2px solid #3498DB',
            paddingBottom: '5px',
            display: 'inline-block'
          }}>
            🏘️ Neighboring Districts
          </h4>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))',
            gap: '10px'
          }}>
            {neighbors.slice(0, 6).map((neighbor, index) => (
              <div key={neighbor.district_name} style={{
                background: '#f8f9fa',
                border: '1px solid #e9ecef',
                borderRadius: '8px',
                padding: '12px',
                borderLeft: `4px solid ${NEIGHBOR_COLORS[index % NEIGHBOR_COLORS.length]}`
              }}>
                <div style={{
                  fontWeight: '500',
                  color: '#495057',
                  fontSize: '14px'
                }}>
                  {neighbor.district_name}, {neighbor.state_name}
                </div>
                {neighbor.distance_km && (
                  <div style={{
                    fontSize: '12px',
                    color: '#6c757d',
                    marginTop: '4px'
                  }}>
                    📏 {neighbor.distance_km} km away
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  };

  const renderChart = () => {
    if (!neighboringInfo) return null;

    let chartData = null;
    let ChartComponent = Bar;

    switch (chartType) {
      case 'comparison':
        chartData = generateComparisonChart();
        ChartComponent = Bar;
        break;
      case 'indicator_comparison':
        chartData = generateIndicatorComparisonChart();
        ChartComponent = Bar;
        break;
      case 'radar':
        chartData = generateRadarChart();
        ChartComponent = Radar;
        break;
      case 'ranking':
        chartData = generateRankingChart();
        ChartComponent = Bar;
        break;
      default:
        chartData = generateComparisonChart();
        ChartComponent = Bar;
    }

    if (!chartData) {
      return (
        <div style={{
          background: 'white',
          border: '1px solid #dee2e6',
          borderRadius: '12px',
          padding: '40px',
          margin: '20px 0',
          textAlign: 'center',
          color: '#6c757d'
        }}>
          <h4>No chart data available</h4>
          <p>Please ensure the query includes indicator data for visualization.</p>
        </div>
      );
    }

    return (
      <div style={{
        background: 'white',
        border: '1px solid #dee2e6',
        borderRadius: '12px',
        padding: '20px',
        margin: '20px 0',
        boxShadow: '0 2px 8px rgba(0,0,0,0.08)'
      }}>
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '20px',
          flexWrap: 'wrap',
          gap: '15px'
        }}>
          <h4 style={{
            color: '#495057',
            fontSize: '16px',
            fontWeight: '600',
            margin: 0
          }}>
            📊 Performance Comparison
          </h4>
          
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
            {/* Chart Type Selector */}
            <select
              value={chartType}
              onChange={(e) => setChartType(e.target.value)}
              style={{
                padding: '6px 12px',
                border: '1px solid #ced4da',
                borderRadius: '6px',
                fontSize: '12px',
                background: 'white'
              }}
            >
              <option value="comparison">Single Indicator</option>
              <option value="indicator_comparison">All Indicators Comparison</option>
              <option value="radar">Multi-Indicator Radar</option>
              <option value="ranking">Overall Ranking</option>
            </select>

            {/* Indicator Selector (only for comparison chart) */}
            {chartType === 'comparison' && availableIndicators.length > 0 && (
              <select
                value={selectedIndicator || ''}
                onChange={(e) => setSelectedIndicator(e.target.value)}
                style={{
                  padding: '6px 12px',
                  border: '1px solid #ced4da',
                  borderRadius: '6px',
                  fontSize: '12px',
                  background: 'white'
                }}
              >
                {availableIndicators.map(indicator => (
                  <option key={indicator.indicator_name} value={indicator.indicator_name}>
                    {indicator.indicator_full_name}
                  </option>
                ))}
              </select>
            )}
          </div>
        </div>

        <div style={{ height: '400px' }}>
          <ChartComponent data={chartData} options={chartOptions} />
        </div>
      </div>
    );
  };

  const renderMap = () => {
    if (chartOnly || mapFeatures.length === 0) return null;

    return (
      <div style={{
        background: 'white',
        border: '1px solid #dee2e6',
        borderRadius: '12px',
        padding: '20px',
        margin: '20px 0',
        boxShadow: '0 2px 8px rgba(0,0,0,0.08)'
      }}>
        <h4 style={{
          color: '#495057',
          fontSize: '16px',
          fontWeight: '600',
          marginBottom: '15px'
        }}>
          🗺️ Geographic View
        </h4>
        
        <div style={{ 
          height: '650px', 
          borderRadius: '8px', 
          overflow: 'hidden',
          position: 'relative'
        }}>
          <Map
            {...viewState}
            onMove={evt => setViewState(evt.viewState)}
            onClick={(e) => {
              const feature = e.features && e.features[0];
              if (feature) {
                const { properties } = feature;
                const districtName = properties.district_name;
                
                // Find district data
                let districtData = null;
                if (properties.district_type === 'target') {
                  districtData = neighboringInfo.targetDistrict;
                } else {
                  districtData = neighboringInfo.neighbors.find(n => 
                    n.district_name === districtName
                  );
                }
                
                if (districtData) {
                  setPopupInfo({
                    districtData,
                    isTarget: properties.district_type === 'target'
                  });
                }
              }
            }}
            interactiveLayerIds={['neighbor-districts-fill']}
            style={{ width: '100%', height: '100%' }}
            mapStyle="mapbox://styles/mapbox/light-v11"
            mapboxAccessToken={MAPBOX_TOKEN}
          >
            <Source
              id="neighbor-districts"
              type="geojson"
              data={{
                type: "FeatureCollection",
                features: mapFeatures
              }}
            >
              <Layer
                id="neighbor-districts-fill"
                type="fill"
                paint={{
                  'fill-color': ['get', 'fill_color'],
                  'fill-opacity': ['get', 'opacity']
                }}
              />
              <Layer
                id="neighbor-districts-stroke"
                type="line"
                paint={{
                  'line-color': ['get', 'stroke_color'],
                  'line-width': 2
                }}
              />
            </Source>
          </Map>
          
          {/* Fixed position popup overlay */}
          {popupInfo && (
            <div className="map-popup-overlay">
              <div className="map-popup-header">
                <span className={`popup-header ${popupInfo.isTarget ? 'target' : 'neighbor'}`}>
                  {popupInfo.districtData.district_name}
                  {popupInfo.isTarget && ' 🎯'}
                </span>
                <button 
                  className="map-popup-close"
                  onClick={() => setPopupInfo(null)}
                  aria-label="Close popup"
                >
                  ✕
                </button>
              </div>
              
              <div className="map-popup-content">
                <div className="popup-field">
                  <strong>State:</strong> {popupInfo.districtData.state_name}
                </div>
                
                {popupInfo.districtData.distance_km !== undefined && (
                  <div className="popup-field">
                    <strong>Distance:</strong> {popupInfo.districtData.distance_km} km
                  </div>
                )}
                
                {popupInfo.districtData.performance?.overall_performance && (
                  <div className="popup-field">
                    <strong>Overall Performance:</strong> {popupInfo.districtData.performance.overall_performance.toFixed(1)} percentile
                  </div>
                )}
                
                {/* Display indicators from either performance.indicators or direct indicators array */}
                {(() => {
                  const indicators = popupInfo.districtData.performance?.indicators || popupInfo.districtData.indicators || [];
                  
                  if (indicators.length > 0) {
                    return (
                      <div>
                        <strong>Indicators:</strong>
                        <div className="popup-indicators-container">
                          {indicators.slice(0, 3).map((indicator, idx) => (
                            <div key={idx} className="popup-indicator-card">
                              <div className="popup-indicator-name">
                                {indicator.indicator_full_name?.length > 35 
                                  ? indicator.indicator_full_name.slice(0, 35) + '...'
                                  : indicator.indicator_full_name
                                }
                              </div>
                              <div className="popup-indicator-values">
                                {indicator.current_value !== undefined && (
                                  <span>Value: {indicator.current_value?.toFixed(1)}</span>
                                )}
                                {indicator.current_value !== undefined && indicator.performance_percentile !== undefined && (
                                  <span> | </span>
                                )}
                                {indicator.performance_percentile !== undefined && (
                                  <span>Percentile: {indicator.performance_percentile?.toFixed(1)}</span>
                                )}
                                {indicator.annual_change !== undefined && (
                                  <span> | Change: {indicator.annual_change > 0 ? '+' : ''}{indicator.annual_change?.toFixed(2)}</span>
                                )}
                              </div>
                            </div>
                          ))}
                          {indicators.length > 3 && (
                            <div className="popup-more-indicators">
                              +{indicators.length - 3} more indicators
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  }
                  return null;
                })()}
              </div>
            </div>
          )}
        </div>

        <div style={{
          marginTop: '15px',
          display: 'flex',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '15px',
          fontSize: '12px'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
            <div style={{
              width: '16px',
              height: '16px',
              backgroundColor: TARGET_COLOR,
              borderRadius: '3px'
            }}></div>
            <span>Target District</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
            <div style={{
              width: '16px',
              height: '16px',
              background: `linear-gradient(90deg, ${NEIGHBOR_COLORS.slice(0, 4).join(', ')})`,
              borderRadius: '3px',
              border: '1px solid #ddd'
            }}></div>
            <span>Neighboring Districts</span>
          </div>
        </div>
      </div>
    );
  };

  if (!neighboringInfo) {
    return (
      <div style={{
        padding: '40px',
        textAlign: 'center',
        color: '#6c757d'
      }}>
        <h3>No neighboring districts data available</h3>
        <p>Please try a different query or check the data source.</p>
      </div>
    );
  }

  return (
    <div style={{
      padding: isModal ? '0' : '20px',
      fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
    }}>
      {!chartOnly && !mapOnly && renderDistrictSummary()}
      {mapOnly && renderDistrictSummary()}
      {!mapOnly && renderChart()}
      {renderMap()}
      {!chartOnly && !mapOnly && renderAnalysisText()}
    </div>
  );
} 
