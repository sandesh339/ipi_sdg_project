import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Bar } from 'react-chartjs-2';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';

import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend
} from 'chart.js';

// Register Chart.js components
ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend
);

// Set Mapbox access token
mapboxgl.accessToken = "pk.eyJ1Ijoic2FuZGVzaDMzOSIsImEiOiJjbThqazJuaTYwaTlwMmtwdzU4NzUwN3YwIn0.Kc6gPcC0Jf2rSJN4ieeimA";

// Color schemes for border districts
const BORDER_COLORS = {
  state1: '#3498db',          // Primary state color
  state2: '#e74c3c',          // Secondary state color (deprecated)
  neighboring: '#2ecc71',     // Neighboring state districts
  mixed: '#9b59b6',          // For mixed cases
  indicator_good: '#27ae60',
  indicator_poor: '#e67e22'
};

// Generate distinct colors for different states
const generateStateColors = (states, targetState) => {
  const colorPalette = [
    '#3498db', // Blue - for target state
    '#e74c3c', // Red
    '#2ecc71', // Green  
    '#f39c12', // Orange
    '#9b59b6', // Purple
    '#1abc9c', // Turquoise
    '#e67e22', // Dark Orange
    '#34495e', // Dark Blue
    '#f1c40f', // Yellow
    '#8e44ad', // Dark Purple
    '#16a085', // Dark Turquoise
    '#27ae60', // Dark Green
    '#d35400', // Dark Orange
    '#2c3e50', // Very Dark Blue
    '#c0392b', // Dark Red
  ];
  
  const stateColors = {};
  let colorIndex = 0;
  
  // Assign target state the first color
  if (targetState) {
    stateColors[targetState] = colorPalette[0];
    colorIndex = 1;
  }
  
  // Assign colors to other states
  states.forEach(state => {
    if (state !== targetState) {
      stateColors[state] = colorPalette[colorIndex % colorPalette.length];
      colorIndex++;
    }
  });
  
  return stateColors;
};

// Map Component for Border Districts
const BorderDistrictsMap = ({ data }) => {
  const mapContainer = useRef(null);
  const map = useRef(null);

  useEffect(() => {
    if (!data || !data.boundary_data || map.current) return;

    console.log('Initializing border districts map with data:', data);

    // Get unique states and generate colors
    const allStates = [...new Set(data.data.map(d => d.state_name))];
    const stateColors = generateStateColors(allStates, data.state);

    // Initialize map
    map.current = new mapboxgl.Map({
      container: mapContainer.current,
      style: 'mapbox://styles/mapbox/light-v11',
      center: [78.9629, 20.5937], // Center of India
      zoom: 5
    });

    map.current.on('load', () => {
      // Create GeoJSON for border districts
      const borderGeoJSON = {
        type: 'FeatureCollection',
        features: data.boundary_data.map((boundary, index) => {
          const districtData = data.data.find(d => 
            d.district_name === boundary.district && d.state_name === boundary.state
          );

          // Calculate average performance for color coding
          let avgPerformance = 0;
          let indicatorCount = 0;
          
          if (districtData && districtData.indicators) {
            const validIndicators = districtData.indicators.filter(ind => ind.current_value !== null);
            if (validIndicators.length > 0) {
              avgPerformance = validIndicators.reduce((sum, ind) => sum + ind.current_value, 0) / validIndicators.length;
              indicatorCount = validIndicators.length;
            }
          }

          return {
            type: 'Feature',
            properties: {
              district_name: boundary.district,
              state_name: boundary.state,
              area_sqkm: boundary.area_sqkm,
              perimeter_km: boundary.perimeter_km,
              shared_boundary_km: districtData?.shared_boundary_km || 0,
              avg_performance: avgPerformance,
              indicator_count: indicatorCount,
              has_data: !!(districtData && districtData.indicators && districtData.indicators.length > 0)
            },
            geometry: boundary.geometry
          };
        })
      };

      console.log('Generated border districts GeoJSON:', borderGeoJSON);

      // Add source
      map.current.addSource('border-districts', {
        type: 'geojson',
        data: borderGeoJSON
      });

      // Build state-based color expression
      const colorExpression = ['case'];
      allStates.forEach(state => {
        colorExpression.push(['==', ['get', 'state_name'], state]);
        colorExpression.push(stateColors[state]);
      });
      colorExpression.push('#cccccc'); // Default color

      // Add fill layer with state-based coloring
      map.current.addLayer({
        id: 'border-districts-fill',
        type: 'fill',
        source: 'border-districts',
        paint: {
          'fill-color': colorExpression,
          'fill-opacity': 0.7
        }
      });

      // Add stroke layer
      map.current.addLayer({
        id: 'border-districts-stroke',
        type: 'line',
        source: 'border-districts',
        paint: {
          'line-color': '#ffffff',
          'line-width': 2
        }
      });

      // Add hover effect
      map.current.addLayer({
        id: 'border-districts-hover',
        type: 'fill',
        source: 'border-districts',
        paint: {
          'fill-color': '#000000',
          'fill-opacity': [
            'case',
            ['boolean', ['feature-state', 'hover'], false],
            0.3,
            0
          ]
        }
      });

      let hoveredStateId = null;

      // Handle hover states
      map.current.on('mousemove', 'border-districts-fill', (e) => {
        if (e.features.length > 0) {
          if (hoveredStateId !== null) {
            map.current.setFeatureState(
              { source: 'border-districts', id: hoveredStateId },
              { hover: false }
            );
          }
          hoveredStateId = e.features[0].id;
          map.current.setFeatureState(
            { source: 'border-districts', id: hoveredStateId },
            { hover: true }
          );
        }
      });

      // Add popups
      map.current.on('click', 'border-districts-fill', (e) => {
        const properties = e.features[0].properties;
        const districtData = data.data.find(d => 
          d.district_name === properties.district_name && d.state_name === properties.state_name
        );

        let popupContent = `
          <div style="font-family: Arial, sans-serif; max-width: 350px; padding: 12px;">
            <h3 style="margin: 0 0 10px 0; color: #2c3e50; font-size: 16px; font-weight: bold;">
              ${properties.district_name}
            </h3>
            <div style="background: linear-gradient(90deg, 
              ${stateColors[properties.state_name] || '#cccccc'}, 
              rgba(255,255,255,0.1)); 
              padding: 8px; 
              border-radius: 4px; 
              margin-bottom: 12px;">
              <strong style="color: white; font-size: 14px;">
                📍 ${properties.state_name} State
              </strong>
              <div style="color: white; font-size: 12px; margin-top: 4px; opacity: 0.9;">
                ${properties.state_name === data.state 
                    ? 'Target State' 
                    : `Neighboring District of ${data.state}`}
              </div>
            </div>
            
            <table style="width: 100%; border-collapse: collapse; font-size: 13px; margin-bottom: 10px;">
              <tr>
                <td style="padding: 4px 0; color: #666; font-weight: 500;">Area:</td>
                <td style="padding: 4px 0; font-weight: 600;">${parseFloat(properties.area_sqkm || 0).toFixed(1)} km²</td>
              </tr>
              <tr>
                <td style="padding: 4px 0; color: #666; font-weight: 500;">Perimeter:</td>
                <td style="padding: 4px 0; font-weight: 600;">${parseFloat(properties.perimeter_km || 0).toFixed(1)} km</td>
              </tr>
              <tr>
                <td style="padding: 4px 0; color: #666; font-weight: 500;">Shared Boundary:</td>
                <td style="padding: 4px 0; font-weight: 600;">${parseFloat(properties.shared_boundary_km || 0).toFixed(1)} km</td>
              </tr>
            </table>
        `;

        if (districtData && districtData.indicators && districtData.indicators.length > 0) {
          popupContent += `
            <div style="border-top: 1px solid #eee; padding-top: 10px;">
              <h4 style="margin: 0 0 8px 0; color: #2c3e50; font-size: 14px;">SDG Indicators (${districtData.indicators.length})</h4>
              <div style="max-height: 200px; overflow-y: auto;">
          `;

          // Show first 5 indicators
          const indicatorsToShow = districtData.indicators.slice(0, 5);
          indicatorsToShow.forEach(indicator => {
            const value = parseFloat(indicator.current_value || 0);
            const change = parseFloat(indicator.actual_annual_change || 0);
            const changeColor = change > 0 ? BORDER_COLORS.indicator_good : BORDER_COLORS.indicator_poor;
            
            popupContent += `
              <div style="margin-bottom: 8px; padding: 6px; background: #f8f9fa; border-radius: 3px;">
                <div style="font-weight: 600; font-size: 12px; color: #2c3e50;">${indicator.indicator_name}</div>
                <div style="display: flex; justify-content: space-between; font-size: 11px;">
                  <span>Value: ${value.toFixed(2)}${indicator.sdg_goal ? ` (SDG ${indicator.sdg_goal})` : ''}</span>
                  <span style="color: ${changeColor};">Change: ${change > 0 ? '+' : ''}${change.toFixed(2)}/year</span>
                </div>
              </div>
            `;
          });

          if (districtData.indicators.length > 5) {
            popupContent += `<div style="color: #666; font-size: 11px; text-align: center;">... and ${districtData.indicators.length - 5} more indicators</div>`;
          }

          popupContent += `</div></div>`;
        } else {
          popupContent += `
            <div style="border-top: 1px solid #eee; padding-top: 10px; text-align: center; color: #666; font-style: italic;">
              No SDG data available for this district
            </div>
          `;
        }

        popupContent += `</div>`;

        new mapboxgl.Popup()
          .setLngLat(e.lngLat)
          .setHTML(popupContent)
          .addTo(map.current);
      });

      // Change cursor on hover
      map.current.on('mouseenter', 'border-districts-fill', () => {
        map.current.getCanvas().style.cursor = 'pointer';
      });

      map.current.on('mouseleave', 'border-districts-fill', () => {
        map.current.getCanvas().style.cursor = '';
        if (hoveredStateId !== null) {
          map.current.setFeatureState(
            { source: 'border-districts', id: hoveredStateId },
            { hover: false }
          );
        }
        hoveredStateId = null;
      });

      // Fit map to border districts
      if (borderGeoJSON.features.length > 0) {
        const bounds = new mapboxgl.LngLatBounds();
        borderGeoJSON.features.forEach(feature => {
          if (feature.geometry.type === 'Polygon') {
            feature.geometry.coordinates[0].forEach(coord => {
              bounds.extend(coord);
            });
          } else if (feature.geometry.type === 'MultiPolygon') {
            feature.geometry.coordinates.forEach(polygon => {
              polygon[0].forEach(coord => {
                bounds.extend(coord);
              });
            });
          }
        });
        map.current.fitBounds(bounds, { padding: 50 });
      }

      // Add improved state-based legend
      const legend = document.createElement('div');
      legend.className = 'border-districts-legend';
      legend.style.cssText = `
        position: absolute;
        top: 10px;
        right: 10px;
        background: rgba(255, 255, 255, 0.95);
        padding: 15px;
        border-radius: 8px;
        box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        font-family: Arial, sans-serif;
        font-size: 12px;
        z-index: 1;
        border: 1px solid #ddd;
        min-width: 180px;
      `;
      
      const legendTitle = document.createElement('div');
      legendTitle.textContent = 'Border Districts';
      legendTitle.style.cssText = 'font-weight: bold; margin-bottom: 10px; font-size: 14px; color: #333;';
      legend.appendChild(legendTitle);
      
      // Add legend items for each state with their specific colors
      allStates.forEach((state, index) => {
        const stateItem = document.createElement('div');
        stateItem.style.cssText = 'display: flex; align-items: center; margin-bottom: 6px;';
        
        const stateColor = document.createElement('div');
        stateColor.style.cssText = `width: 16px; height: 16px; background-color: ${stateColors[state]}; margin-right: 8px; border-radius: 3px; flex-shrink: 0;`;
        
        const stateLabel = document.createElement('span');
        stateLabel.textContent = state === data.state ? `${state} (Target)` : state;
        stateLabel.style.cssText = `color: #555; font-size: 12px; ${state === data.state ? 'font-weight: 600;' : ''}`;
        
        stateItem.appendChild(stateColor);
        stateItem.appendChild(stateLabel);
        legend.appendChild(stateItem);
      });
      
      map.current.getContainer().appendChild(legend);
    });

    return () => {
      if (map.current) {
        // Remove legend
        const legend = map.current.getContainer().querySelector('.border-districts-legend');
        if (legend) {
          legend.remove();
        }
        map.current.remove();
        map.current = null;
      }
    };
  }, [data]);

  return (
    <div style={{ height: '100vh', width: '100%', position: 'relative' }}>
      <div ref={mapContainer} style={{ height: '100%', width: '100%' }} />
    </div>
  );
};

const BorderDistrictsAnalysis = ({ borderData, mapOnly = false, chartOnly = false }) => {
  const [selectedIndicator, setSelectedIndicator] = useState(null);
  const [chartType, setChartType] = useState('district_performance');
  const [processedData, setProcessedData] = useState(null);
  const [districtData, setDistrictData] = useState([]);
  const [indicators, setIndicators] = useState([]);

  // Process the data when it changes
  useEffect(() => {
    if (!borderData || !borderData.data) {
      console.log('No border districts data available');
      return;
    }

    // Process the data
    const districts = borderData.data || [];
    const stateGroups = {};
    
    // Get all unique indicators
    const allIndicators = [];
    const indicatorSet = new Set();
    
    districts.forEach(district => {
      const state = district.state_name;
      if (!stateGroups[state]) {
        stateGroups[state] = [];
      }
      stateGroups[state].push(district);

      // Collect unique indicators
      if (district.indicators) {
        district.indicators.forEach(indicator => {
          if (!indicatorSet.has(indicator.indicator_name)) {
            indicatorSet.add(indicator.indicator_name);
            allIndicators.push(indicator);
          }
        });
      }
    });

    const processedDataObj = {
      districts,
      stateGroups,
      indicators: allIndicators,
      totalDistricts: districts.length,
      totalIndicators: allIndicators.length
    };

    setProcessedData(processedDataObj);
    setIndicators(allIndicators);

    // Set initial indicator only if we don't have one
    if (!selectedIndicator && allIndicators.length > 0) {
      setSelectedIndicator(allIndicators[0]);
    }

  }, [borderData, selectedIndicator]); // Include selectedIndicator to prevent setting it repeatedly

  // Update district data when selected indicator changes
  useEffect(() => {
    if (!processedData?.districts || !selectedIndicator) return;

    const allStates = [...new Set(processedData.districts.map(d => d.state_name))];
    const stateColors = generateStateColors(allStates, borderData?.state);

    const newDistrictData = [];
    processedData.districts.forEach(district => {
      const indicator = district.indicators?.find(ind => 
        ind.indicator_name === selectedIndicator.indicator_name
      );
      if (indicator && (indicator.current_value !== null || indicator.nfhs_4_value !== null)) {
        newDistrictData.push({
          name: district.district_name,
          nfhs4Value: indicator.nfhs_4_value || 0,
          nfhs5Value: indicator.nfhs_5_value || indicator.current_value || 0,
          state: district.state_name,
          shared_boundary_km: district.shared_boundary_km || 0,
          fullLabel: `${district.district_name} (${district.state_name}, ${district.shared_boundary_km?.toFixed(1) || 0} km)`
        });
      }
    });

    // Sort by shared boundary length
    newDistrictData.sort((a, b) => b.shared_boundary_km - a.shared_boundary_km);
    setDistrictData(newDistrictData);

  }, [processedData, selectedIndicator, borderData?.state]);

  // Generate state comparison chart
  const generateStateComparisonChart = () => {
    if (!processedData?.districts || !processedData?.stateGroups || !selectedIndicator) {
      console.log('Missing required data for state comparison chart');
      return null;
    }

    try {
      // Get unique states and generate colors
      const allStates = [...new Set(processedData.districts.map(d => d.state_name))];
      if (!allStates.length) {
        console.log('No states found in data');
        return null;
      }

      const stateColors = generateStateColors(allStates, borderData?.state);
      const stateAverages = {};
      
      Object.entries(processedData.stateGroups).forEach(([state, districts]) => {
        const values = [];
        let totalBoundary = 0;
        
        districts.forEach(district => {
          const indicator = district.indicators?.find(ind => 
            ind.indicator_name === selectedIndicator.indicator_name
          );
          if (indicator && indicator.current_value !== null) {
            values.push(indicator.current_value);
            totalBoundary += district.shared_boundary_km || 0;
          }
        });
        
        if (values.length > 0) {
          stateAverages[state] = {
            average: values.reduce((sum, val) => sum + val, 0) / values.length,
            districtCount: values.length,
            totalBoundary: totalBoundary
          };
        }
      });

      const states = Object.keys(stateAverages);
      if (!states.length) {
        console.log('No state averages calculated');
        return null;
      }

      const averages = states.map(state => stateAverages[state].average);
      
      return {
        labels: states.map(state => `${state}\n(${stateAverages[state].districtCount} districts, ${stateAverages[state].totalBoundary.toFixed(1)} km)`),
        datasets: [{
          label: `Average ${selectedIndicator.indicator_name}`,
          data: averages,
          backgroundColor: states.map(state => stateColors[state]),
          borderColor: states.map(state => stateColors[state]),
          borderWidth: 1
        }]
      };
    } catch (error) {
      console.error('Error generating state comparison chart:', error);
      return null;
    }
  };

  // Generate district performance chart
  const generateDistrictPerformanceChart = () => {
    if (!processedData?.districts || !selectedIndicator || !districtData.length) {
      console.log('Missing required data for district performance chart');
      return null;
    }

    try {
      // Get unique states and generate colors
      const allStates = [...new Set(processedData.districts.map(d => d.state_name))];
      if (!allStates.length) {
        console.log('No states found in data');
        return null;
      }

      const stateColors = generateStateColors(allStates, borderData?.state);
      
      // Create datasets for stacked bars
      const datasets = [];
      
      // Create base dataset (NFHS-4 values)
      datasets.push({
        label: 'NFHS-4 (2016)',
        data: districtData.map(d => d.nfhs4Value),
        backgroundColor: districtData.map(d => stateColors[d.state] + '80'), // Add transparency
        borderColor: districtData.map(d => stateColors[d.state]),
        borderWidth: 1,
        stack: 'Stack 0' // All bars will be in the same stack
      });

      // Create change dataset (difference between NFHS-5 and NFHS-4)
      datasets.push({
        label: 'Change to NFHS-5 (2021)',
        data: districtData.map(d => d.nfhs5Value - d.nfhs4Value),
        backgroundColor: districtData.map(d => stateColors[d.state]),
        borderColor: districtData.map(d => stateColors[d.state]),
        borderWidth: 1,
        stack: 'Stack 0' // Same stack as the base values
      });

      return {
        labels: districtData.map(d => d.name),
        datasets: datasets
      };
    } catch (error) {
      console.error('Error generating district performance chart:', error);
      return null;
    }
  };

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: 'top',
      },
      title: {
        display: true,
        text: selectedIndicator ? 
          `${selectedIndicator.indicator_name} - Border Districts Comparison (2016 vs 2021)` : 
          'Border Districts Analysis - Comparison (2016 vs 2021)'
      },
      tooltip: {
        callbacks: {
          title: function(context) {
            const dataIndex = context[0].dataIndex;
            const district = districtData[dataIndex];
            if (district) {
              let tooltip = `${district.name} (${district.state})\nShared Boundary: ${district.shared_boundary_km.toFixed(1)} km`;
              const change = district.nfhs5Value - district.nfhs4Value;
              const changePercent = ((change / district.nfhs4Value) * 100).toFixed(1);
              tooltip += `\n\nNFHS-4 (2016): ${district.nfhs4Value.toFixed(2)}`;
              tooltip += `\nNFHS-5 (2021): ${district.nfhs5Value.toFixed(2)}`;
              tooltip += `\nChange: ${change > 0 ? '+' : ''}${change.toFixed(2)} (${changePercent}%)`;
              return tooltip;
            }
            return context[0].label;
          },
          label: function(context) {
            const datasetLabel = context.dataset.label;
            const value = context.parsed.y.toFixed(2);
            if (datasetLabel === 'NFHS-4 (2016)') {
              return `Base value: ${value}`;
            } else {
              return `Change: ${value > 0 ? '+' : ''}${value}`;
            }
          }
        }
      }
    },
    scales: {
      x: {
        title: {
          display: true,
          text: chartType === 'state_comparison' ? 'States' : 'Districts (sorted by shared boundary length)',
          font: {
            size: 12,
            weight: 'bold'
          }
        }
      },
      y: {
        beginAtZero: true,
        title: {
          display: true,
          text: selectedIndicator ? `${selectedIndicator.indicator_name} Value` : 'Indicator Value',
          font: {
            size: 12,
            weight: 'bold'
          }
        },
        stacked: true // Enable stacking for the Y axis
      },
    },
  };

  // Early return if no data
  if (!borderData || !borderData.data) {
    return (
      <div style={{ textAlign: 'center', padding: '40px', color: '#666' }}>
        <p>No border districts data available for visualization.</p>
      </div>
    );
  }

  // Early return if no processed data
  if (!processedData || !selectedIndicator) {
    return (
      <div style={{ textAlign: 'center', padding: '40px', color: '#666' }}>
        <p>Processing data...</p>
      </div>
    );
  }

  if (mapOnly) {
    return (
      <div style={{ width: '100%', height: '100%' }}>
        <BorderDistrictsMap data={borderData} />
      </div>
    );
  }

  if (chartOnly) {
    const chartData = chartType === 'state_comparison' ? 
      generateStateComparisonChart() : 
      generateDistrictPerformanceChart();

    return (
      <div style={{ width: '100%', height: '100%', padding: '20px' }}>
        {/* Indicator Selection */}
        <div style={{ 
          background: '#f8f9fa', 
          padding: '20px', 
          borderRadius: '12px', 
          marginBottom: '24px',
          border: '1px solid #dee2e6'
        }}>
          <h4 style={{ margin: '0 0 16px 0', color: '#495057' }}>Analysis Controls</h4>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
            <div>
              <label style={{ display: 'block', marginBottom: '8px', fontWeight: '500', color: '#495057' }}>
                Select Indicator:
              </label>
              <select
                value={selectedIndicator?.indicator_name || ''}
                onChange={(e) => {
                  const indicator = indicators.find(ind => 
                    ind.indicator_name === e.target.value
                  );
                  setSelectedIndicator(indicator);
                }}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  borderRadius: '6px',
                  border: '1px solid #ced4da',
                  fontSize: '14px'
                }}
              >
                {indicators.map(indicator => (
                  <option key={indicator.indicator_name} value={indicator.indicator_name}>
                    {indicator.indicator_name} (SDG {indicator.sdg_goal})
                  </option>
                ))}
              </select>
            </div>
            
            <div>
              <label style={{ display: 'block', marginBottom: '8px', fontWeight: '500', color: '#495057' }}>
                Chart Type:
              </label>
              <select
                value={chartType}
                onChange={(e) => setChartType(e.target.value)}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  borderRadius: '6px',
                  border: '1px solid #ced4da',
                  fontSize: '14px'
                }}
              >
                <option value="state_comparison">State Comparison</option>
                <option value="district_performance">District Performance</option>
              </select>
            </div>
          </div>
        </div>

        {/* Chart */}
        <div style={{ height: '400px', width: '100%' }}>
          {!chartData ? (
            <div style={{ 
              height: '100%', 
              display: 'flex', 
              alignItems: 'center', 
              justifyContent: 'center',
              color: '#666',
              backgroundColor: '#f8f9fa',
              borderRadius: '8px'
            }}>
              <p>Loading chart data...</p>
            </div>
          ) : (
            <Bar 
              data={chartData} 
              options={chartOptions}
            />
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="border-analysis-container" style={{ padding: '20px' }}>
      {/* Summary Cards */}
      <div style={{ 
        display: 'grid', 
        gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', 
        gap: '16px', 
        marginBottom: '32px' 
      }}>
        <div style={{ 
          background: 'linear-gradient(135deg, #e8f4f8 0%, #d1ecf1 100%)',
          padding: '20px', 
          borderRadius: '12px', 
          border: '1px solid #bee5eb',
          textAlign: 'center'
        }}>
          <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#0c5460' }}>
            {processedData.totalDistricts}
          </div>
          <div style={{ fontSize: '14px', color: '#0c5460', marginTop: '4px' }}>
            Border Districts
          </div>
        </div>
        
        <div style={{ 
          background: 'linear-gradient(135deg, #f3e5f5 0%, #e1bee7 100%)',
          padding: '20px', 
          borderRadius: '12px', 
          border: '1px solid #ce93d8',
          textAlign: 'center'
        }}>
          <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#4a148c' }}>
            {Object.keys(processedData.stateGroups).length}
          </div>
          <div style={{ fontSize: '14px', color: '#4a148c', marginTop: '4px' }}>
            States Involved
          </div>
        </div>
        
        <div style={{ 
          background: 'linear-gradient(135deg, #e8f5e8 0%, #c8e6c9 100%)',
          padding: '20px', 
          borderRadius: '12px', 
          border: '1px solid #a5d6a7',
          textAlign: 'center'
        }}>
          <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#1b5e20' }}>
            {processedData.totalIndicators}
          </div>
          <div style={{ fontSize: '14px', color: '#1b5e20', marginTop: '4px' }}>
            SDG Indicators
          </div>
        </div>
      </div>

      {/* Map */}
      <div style={{ marginBottom: '32px' }}>
        <h3 style={{ marginBottom: '16px', color: '#495057' }}>🗺️ Border Districts Map</h3>
        <div style={{ height: '500px', width: '100%', borderRadius: '8px', overflow: 'hidden' }}>
          <BorderDistrictsMap data={borderData} />
        </div>
      </div>
    </div>
  );
};

export default BorderDistrictsAnalysis; 