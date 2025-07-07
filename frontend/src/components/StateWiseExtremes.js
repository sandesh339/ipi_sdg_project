import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Bar, Radar } from 'react-chartjs-2';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';


import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  RadialLinearScale,
  PointElement,
  LineElement,
  Filler,
  Title,
  Tooltip,
  Legend,
} from 'chart.js';

// Register Chart.js components
ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  RadialLinearScale,
  PointElement,
  LineElement,
  Filler,
  Title,
  Tooltip,
  Legend
);
// Set Mapbox access token
mapboxgl.accessToken = "pk.eyJ1Ijoic2FuZGVzaDMzOSIsImEiOiJjbThqazJuaTYwaTlwMmtwdzU4NzUwN3YwIn0.Kc6gPcC0Jf2rSJN4ieeimA";

// Map Component for State-wise Extremes
const StateWiseExtremesMap = ({ data }) => {
  const mapContainer = useRef(null);
  const map = useRef(null);

  useEffect(() => {
    if (!data || !data.state_results || map.current) return;

    // Initialize map
    map.current = new mapboxgl.Map({
      container: mapContainer.current,
      style: 'mapbox://styles/mapbox/light-v11',
      center: [78.9629, 20.5937], // Center of India
      zoom: 4
    });

    map.current.on('load', () => {
      // Add boundary data if available
      if (data.boundary_data && data.boundary_data.length > 0) {
        
        // Create GeoJSON for best performers
        const bestPerformersGeoJSON = {
          type: 'FeatureCollection',
          features: []
        };

        // Create GeoJSON for worst performers
        const worstPerformersGeoJSON = {
          type: 'FeatureCollection',
          features: []
        };

        // Process state results and match with boundary data
        data.state_results.forEach((stateResult, index) => {
          const bestDistrict = stateResult.best_performer;
          const worstDistrict = stateResult.worst_performer;

          // Find boundary data for best performer
          const bestBoundary = data.boundary_data.find(
            boundary => (boundary.district || boundary.district_name) === bestDistrict.district_name
          );

          
          if (bestBoundary && (bestBoundary.geometry || bestBoundary.boundary)) {
            bestPerformersGeoJSON.features.push({
              type: 'Feature',
              properties: {
                district_name: bestDistrict.district_name,
                state_name: stateResult.state_name,
                value: bestDistrict.current_value,
                percentile: bestDistrict.state_percentile,
                annual_change: bestDistrict.annual_change,
                type: 'best'
              },
              geometry: bestBoundary.geometry || bestBoundary.boundary
            });
          }

          // Find boundary data for worst performer
          const worstBoundary = data.boundary_data.find(
            boundary => (boundary.district || boundary.district_name) === worstDistrict.district_name
          );
          if (worstBoundary && (worstBoundary.geometry || worstBoundary.boundary)) {
            worstPerformersGeoJSON.features.push({
              type: 'Feature',
              properties: {
                district_name: worstDistrict.district_name,
                state_name: stateResult.state_name,
                value: worstDistrict.current_value,
                percentile: worstDistrict.state_percentile,
                annual_change: worstDistrict.annual_change,
                type: 'worst'
              },
              geometry: worstBoundary.geometry || worstBoundary.boundary
            });
          }
        });

        // Add sources
        map.current.addSource('best-performers', {
          type: 'geojson',
          data: bestPerformersGeoJSON
        });

        map.current.addSource('worst-performers', {
          type: 'geojson',
          data: worstPerformersGeoJSON
        });

        // Add layers for best performers
        map.current.addLayer({
          id: 'best-performers-fill',
          type: 'fill',
          source: 'best-performers',
          paint: {
            'fill-color': '#28a745',
            'fill-opacity': 0.7
          }
        });

        map.current.addLayer({
          id: 'best-performers-stroke',
          type: 'line',
          source: 'best-performers',
          paint: {
            'line-color': '#1e7e34',
            'line-width': 2
          }
        });

        // Add layers for worst performers
        map.current.addLayer({
          id: 'worst-performers-fill',
          type: 'fill',
          source: 'worst-performers',
          paint: {
            'fill-color': '#dc3545',
            'fill-opacity': 0.7
          }
        });

        map.current.addLayer({
          id: 'worst-performers-stroke',
          type: 'line',
          source: 'worst-performers',
          paint: {
            'line-color': '#c82333',
            'line-width': 2
          }
        });

        // Add popups
        const createPopup = (layerId, type) => {
          map.current.on('click', layerId, (e) => {
            const properties = e.features[0].properties;
            const popupContent = `
              <div style="font-family: Arial, sans-serif;">
                <h3 style="margin: 0 0 10px 0; color: ${type === 'best' ? '#28a745' : '#dc3545'};">
                  ${type === 'best' ? '🏆 Best' : '⚠️ Worst'} Performer
                </h3>
                <p><strong>District:</strong> ${properties.district_name}</p>
                <p><strong>State:</strong> ${properties.state_name}</p>
                <p><strong>Value:</strong> ${parseFloat(properties.value).toFixed(2)}</p>
                <p><strong>State Percentile:</strong> ${parseFloat(properties.percentile).toFixed(1)}%</p>
                <p><strong>Annual Change:</strong> ${parseFloat(properties.annual_change).toFixed(2)}</p>
              </div>
            `;

            new mapboxgl.Popup()
              .setLngLat(e.lngLat)
              .setHTML(popupContent)
              .addTo(map.current);
          });

          // Change cursor on hover
          map.current.on('mouseenter', layerId, () => {
            map.current.getCanvas().style.cursor = 'pointer';
          });

          map.current.on('mouseleave', layerId, () => {
            map.current.getCanvas().style.cursor = '';
          });
        };

        createPopup('best-performers-fill', 'best');
        createPopup('worst-performers-fill', 'worst');
      } else {
        // Add a text overlay indicating no map data
        const noDataDiv = document.createElement('div');
        noDataDiv.innerHTML = `
          <div style="
            position: absolute; 
            top: 50%; 
            left: 50%; 
            transform: translate(-50%, -50%);
            background: rgba(255,255,255,0.9);
            padding: 20px;
            border-radius: 8px;
            text-align: center;
            font-family: Arial, sans-serif;
            color: #666;
            box-shadow: 0 2px 8px rgba(0,0,0,0.1);
          ">
            <h4 style="margin: 0 0 10px 0; color: #333;">Map Data Unavailable</h4>
            <p style="margin: 0; font-size: 14px;">Geographic boundaries are not available for visualization.</p>
          </div>
        `;
        mapContainer.current.appendChild(noDataDiv);
      }
    });

    return () => {
      if (map.current) {
        map.current.remove();
        map.current = null;
      }
    };
  }, [data]);

  return (
    <div style={{ position: 'relative', width: '100%', height: '500px' }}>
      <div ref={mapContainer} style={{ width: '100%', height: '100%' }} />
      
      {/* Map Legend */}
      <div style={{
        position: 'absolute',
        top: '10px',
        right: '10px',
        background: 'white',
        padding: '10px',
        borderRadius: '5px',
        boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
        fontSize: '12px'
      }}>
        <div style={{ marginBottom: '5px', fontWeight: 'bold' }}>State-wise Extremes</div>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: '3px' }}>
          <div style={{ 
            width: '15px', 
            height: '15px', 
            backgroundColor: '#28a745', 
            marginRight: '5px',
            border: '1px solid #1e7e34'
          }}></div>
          Best Performers
        </div>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <div style={{ 
            width: '15px', 
            height: '15px', 
            backgroundColor: '#dc3545', 
            marginRight: '5px',
            border: '1px solid #c82333'
          }}></div>
          Worst Performers
        </div>
      </div>
    </div>
  );
};

const StateWiseExtremes = ({ extremesData, mapOnly = false, chartOnly = false }) => {
  // Debug logging to understand data structure
  console.log('StateWiseExtremes received data:', {
    extremesData,
    hasStateResults: !!extremesData?.state_results,
    stateResultsLength: extremesData?.state_results?.length,
    keys: extremesData ? Object.keys(extremesData) : 'no data'
  });

  const [selectedStates, setSelectedStates] = useState([]);
  const [chartType, setChartType] = useState('performance_gap');
  const [sortBy, setSortBy] = useState('gap_desc');
  const [showTopStates, setShowTopStates] = useState(10);

  // Color schemes
  const BEST_COLOR = '#28a745';
  const WORST_COLOR = '#dc3545';
  const GAP_COLOR = '#ffc107';
  const IMPROVEMENT_COLOR = '#17a2b8';

  // Process data for visualizations
  const processedData = useMemo(() => {
    console.log('Processing data for charts...', {
      hasExtremes: !!extremesData,
      hasStateResults: !!extremesData?.state_results,
      stateResultsType: typeof extremesData?.state_results,
      stateResultsLength: extremesData?.state_results?.length
    });

    if (!extremesData?.state_results) {
      console.log('No state_results found, returning null');
      return null;
    }

    const stateData = extremesData.state_results.map(state => {
      const best = state.best_performer;
      const worst = state.worst_performer;
      const gap = best && worst ? Math.abs(best.current_value - worst.current_value) : 0;
      
      return {
        state_name: state.state_name,
        total_districts: state.total_districts,
        best_value: best?.current_value || 0,
        worst_value: worst?.current_value || 0,
        best_district: best?.district_name || 'N/A',
        worst_district: worst?.district_name || 'N/A',
        best_change: best?.annual_change || 0,
        worst_change: worst?.annual_change || 0,
        performance_gap: gap,
        best_improving: extremesData.higher_is_better ? 
          (best?.annual_change || 0) > 0 : (best?.annual_change || 0) < 0,
        worst_improving: extremesData.higher_is_better ? 
          (worst?.annual_change || 0) > 0 : (worst?.annual_change || 0) < 0
      };
    });

    console.log('Processed state data:', {
      stateDataLength: stateData.length,
      firstState: stateData[0],
      hasValidData: stateData.length > 0
    });

    // Sort data based on selected criteria
    const sortedData = [...stateData].sort((a, b) => {
      switch (sortBy) {
        case 'gap_desc':
          return b.performance_gap - a.performance_gap;
        case 'gap_asc':
          return a.performance_gap - b.performance_gap;
        case 'best_desc':
          return extremesData.higher_is_better ? 
            b.best_value - a.best_value : a.best_value - b.best_value;
        case 'worst_desc':
          return extremesData.higher_is_better ? 
            a.worst_value - b.worst_value : b.worst_value - a.worst_value;
        case 'alphabetical':
          return a.state_name.localeCompare(b.state_name);
        default:
          return 0;
      }
    });

    return {
      all: stateData,
      sorted: sortedData,
      top: sortedData.slice(0, showTopStates)
    };
  }, [extremesData, sortBy, showTopStates]);

  const generateTestChart = () => {
    return {
      labels: ['Test 1', 'Test 2', 'Test 3'],
      datasets: [
        {
          label: 'Test Data',
          data: [10, 20, 30],
          backgroundColor: '#007bff',
          borderColor: '#007bff',
          borderWidth: 1,
        }
      ]
    };
  };

  // Chart generation functions
  const generatePerformanceGapChart = () => {
    if (!processedData) {
      console.log('generatePerformanceGapChart: No processedData');
      return null;
    }

    const data = processedData.top;
    console.log('generatePerformanceGapChart: Processing data:', {
      topDataLength: data.length,
      firstItem: data[0],
      sampleGaps: data.slice(0, 3).map(d => ({ state: d.state_name, gap: d.performance_gap }))
    });
    
    const chartData = {
      labels: data.map(d => d.state_name),
      datasets: [
        {
          label: 'Performance Gap',
          data: data.map(d => d.performance_gap),
          backgroundColor: GAP_COLOR,
          borderColor: GAP_COLOR,
          borderWidth: 1,
        }
      ]
    };

    console.log('generatePerformanceGapChart: Generated chart data:', {
      labelsCount: chartData.labels.length,
      dataCount: chartData.datasets[0].data.length,
      sampleLabels: chartData.labels.slice(0, 3),
      sampleData: chartData.datasets[0].data.slice(0, 3)
    });

    return chartData;
  };

  const generateBestWorstChart = () => {
    if (!processedData) return null;

    const data = processedData.top;
    
    return {
      labels: data.map(d => d.state_name),
      datasets: [
        {
          label: 'Best Performer',
          data: data.map(d => d.best_value),
          backgroundColor: BEST_COLOR,
          borderColor: BEST_COLOR,
          borderWidth: 1,
        },
        {
          label: 'Worst Performer',
          data: data.map(d => d.worst_value),
          backgroundColor: WORST_COLOR,
          borderColor: WORST_COLOR,
          borderWidth: 1,
        }
      ]
    };
  };

  // Auto-select top 3 states when switching to radar comparison
  useEffect(() => {
    if (chartType === 'radar_comparison' && processedData && selectedStates.length === 0) {
      const topStates = processedData.top.slice(0, 3).map(state => state.state_name);
      setSelectedStates(topStates);
    }
  }, [chartType, processedData]);

  const generateComparisonRadarChart = () => {
    if (!processedData || selectedStates.length === 0) {
      // Auto-select top 3 states if none selected
      if (processedData && processedData.top && processedData.top.length > 0) {
        const topStates = processedData.top.slice(0, 3).map(state => state.state_name);
        setSelectedStates(topStates);
        return null; // Will re-render with selected states
      }
      return null;
    }

    const selectedData = processedData.all.filter(d => 
      selectedStates.includes(d.state_name)
    );

    if (selectedData.length === 0) return null;

    const indicators = ['Best Performance', 'Worst Performance', 'Performance Gap', 'Districts Count'];
    
    const datasets = selectedData.map((state, index) => {
      const colors = ['#FF6384', '#36A2EB', '#FFCE56', '#4BC0C0', '#9966FF'];
      const color = colors[index % colors.length];
      
      // Normalize values for radar chart (0-100 scale)
      const maxBest = Math.max(...processedData.all.map(d => d.best_value));
      const maxWorst = Math.max(...processedData.all.map(d => d.worst_value));
      const maxGap = Math.max(...processedData.all.map(d => d.performance_gap));
      const maxDistricts = Math.max(...processedData.all.map(d => d.total_districts));
      
      return {
        label: state.state_name,
        data: [
          (state.best_value / maxBest) * 100,
          (state.worst_value / maxWorst) * 100,
          (state.performance_gap / maxGap) * 100,
          (state.total_districts / maxDistricts) * 100
        ],
        borderColor: color,
        backgroundColor: color + '20',
        pointBackgroundColor: color,
        pointBorderColor: color,
        pointHoverBackgroundColor: '#fff',
        pointHoverBorderColor: color
      };
    });

    return {
      labels: indicators,
      datasets: datasets
    };
  };

  const generateTrendChart = () => {
    if (!processedData) return null;

    const data = processedData.top;
    
    return {
      labels: data.map(d => d.state_name),
      datasets: [
        {
          label: 'Best Performer Trend',
          data: data.map(d => d.best_change),
          backgroundColor: data.map(d => d.best_improving ? IMPROVEMENT_COLOR : WORST_COLOR),
          borderColor: data.map(d => d.best_improving ? IMPROVEMENT_COLOR : WORST_COLOR),
          borderWidth: 1,
        },
        {
          label: 'Worst Performer Trend',
          data: data.map(d => d.worst_change),
          backgroundColor: data.map(d => d.worst_improving ? IMPROVEMENT_COLOR : WORST_COLOR),
          borderColor: data.map(d => d.worst_improving ? IMPROVEMENT_COLOR : WORST_COLOR),
          borderWidth: 1,
        }
      ]
    };
  };

  const renderChart = () => {
    console.log('renderChart called:', {
      hasProcessedData: !!processedData,
      chartType,
      processedDataKeys: processedData ? Object.keys(processedData) : 'no processed data'
    });

    if (!processedData) {
      console.log('renderChart: No processedData, returning null');
      return null;
    }

    let chartData = null;
    let ChartComponent = Bar;

    switch (chartType) {
      case 'performance_gap':
        chartData = generatePerformanceGapChart();
        break;
      case 'best_worst':
        chartData = generateBestWorstChart();
        break;
      case 'trends':
        chartData = generateTrendChart();
        break;
      case 'radar_comparison':
        chartData = generateComparisonRadarChart();
        ChartComponent = Radar;
        break;
      case 'test':
        chartData = generateTestChart();
        break;
      default:
        chartData = generatePerformanceGapChart();
    }

    console.log('renderChart: Generated chart data:', {
      chartType,
      hasChartData: !!chartData,
      chartDataKeys: chartData ? Object.keys(chartData) : 'no chart data'
    });

    if (!chartData) {
      console.log('renderChart: No chartData generated, returning null');
      return null;
    }

    return (
      <div style={{ 
        minHeight: '500px',
        height: '500px', 
        width: '100%',
        position: 'relative'
      }}>
        <ChartComponent 
          key={`chart-${chartType}-${Date.now()}`}
          data={chartData} 
          options={ChartComponent === Radar ? {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
              legend: {
                display: true,
                position: 'top'
              },
              title: {
                display: true,
                text: 'State Comparison (Normalized Values)'
              }
            },
            scales: {
              r: {
                beginAtZero: true,
                max: 100,
                grid: {
                  color: 'rgba(0,0,0,0.1)'
                }
              }
            }
          } : {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
              legend: {
                display: true,
                position: 'top'
              },
              title: {
                display: true,
                text: `State-wise ${chartType.replace('_', ' ').toUpperCase()} Analysis`
              }
            },
            scales: {
              y: {
                beginAtZero: true,
                grid: {
                  color: 'rgba(0,0,0,0.1)'
                }
              },
              x: {
                grid: {
                  display: false
                }
              }
            }
          }} 
        />
      </div>
    );
  };

  const renderStateSelector = () => {
    if (!processedData || chartType !== 'radar_comparison') return null;

    return (
      <div style={{ marginBottom: '20px' }}>
        <label style={{ fontWeight: 'bold', marginBottom: '10px', display: 'block' }}>
          Select States for Comparison (max 5):
        </label>
        <div style={{ 
          display: 'flex', 
          flexWrap: 'wrap', 
          gap: '10px',
          maxHeight: '150px',
          overflowY: 'auto',
          border: '1px solid #ddd',
          padding: '10px',
          borderRadius: '4px'
        }}>
          {processedData.all.map(state => (
            <label key={state.state_name} style={{ 
              display: 'flex', 
              alignItems: 'center',
              fontSize: '14px',
              cursor: 'pointer',
              padding: '4px 8px',
              backgroundColor: selectedStates.includes(state.state_name) ? '#e3f2fd' : 'transparent',
              borderRadius: '4px'
            }}>
              <input
                type="checkbox"
                checked={selectedStates.includes(state.state_name)}
                onChange={(e) => {
                  if (e.target.checked && selectedStates.length < 5) {
                    setSelectedStates([...selectedStates, state.state_name]);
                  } else if (!e.target.checked) {
                    setSelectedStates(selectedStates.filter(s => s !== state.state_name));
                  }
                }}
                disabled={!selectedStates.includes(state.state_name) && selectedStates.length >= 5}
                style={{ marginRight: '6px' }}
              />
              {state.state_name}
            </label>
          ))}
        </div>
      </div>
    );
  };

  const renderSummaryCards = () => {
    if (!processedData) return null;

    const overallBest = processedData.all.reduce((best, current) => 
      extremesData.higher_is_better ? 
        (current.best_value > best.best_value ? current : best) :
        (current.best_value < best.best_value ? current : best)
    );

    const overallWorst = processedData.all.reduce((worst, current) => 
      extremesData.higher_is_better ? 
        (current.worst_value < worst.worst_value ? current : worst) :
        (current.worst_value > worst.worst_value ? current : worst)
    );

    const largestGap = processedData.all.reduce((max, current) => 
      current.performance_gap > max.performance_gap ? current : max
    );

    const smallestGap = processedData.all.reduce((min, current) => 
      current.performance_gap < min.performance_gap ? current : min
    );

    return (
      <div style={{ 
        display: 'grid', 
        gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
        gap: '20px',
        marginBottom: '20px'
      }}>
        <div style={{
          background: 'linear-gradient(135deg, #28a745, #20c997)',
          color: 'white',
          padding: '20px',
          borderRadius: '12px',
          boxShadow: '0 4px 6px rgba(0,0,0,0.1)'
        }}>
          <h4 style={{ margin: '0 0 10px 0', fontSize: '16px' }}>🏆 Overall Best</h4>
          <div style={{ fontSize: '24px', fontWeight: 'bold', marginBottom: '5px' }}>
            {overallBest.best_value.toFixed(2)}
          </div>
          <div style={{ fontSize: '14px', opacity: 0.9 }}>
            {overallBest.best_district}, {overallBest.state_name}
          </div>
        </div>

        <div style={{
          background: 'linear-gradient(135deg, #dc3545, #e83e8c)',
          color: 'white',
          padding: '20px',
          borderRadius: '12px',
          boxShadow: '0 4px 6px rgba(0,0,0,0.1)'
        }}>
          <h4 style={{ margin: '0 0 10px 0', fontSize: '16px' }}>📉 Overall Worst</h4>
          <div style={{ fontSize: '24px', fontWeight: 'bold', marginBottom: '5px' }}>
            {overallWorst.worst_value.toFixed(2)}
          </div>
          <div style={{ fontSize: '14px', opacity: 0.9 }}>
            {overallWorst.worst_district}, {overallWorst.state_name}
          </div>
        </div>

        <div style={{
          background: 'linear-gradient(135deg, #ffc107, #fd7e14)',
          color: 'white',
          padding: '20px',
          borderRadius: '12px',
          boxShadow: '0 4px 6px rgba(0,0,0,0.1)'
        }}>
          <h4 style={{ margin: '0 0 10px 0', fontSize: '16px' }}>📊 Largest Gap</h4>
          <div style={{ fontSize: '24px', fontWeight: 'bold', marginBottom: '5px' }}>
            {largestGap.performance_gap.toFixed(2)}
          </div>
          <div style={{ fontSize: '14px', opacity: 0.9 }}>
            {largestGap.state_name}
          </div>
        </div>

        <div style={{
          background: 'linear-gradient(135deg, #17a2b8, #6f42c1)',
          color: 'white',
          padding: '20px',
          borderRadius: '12px',
          boxShadow: '0 4px 6px rgba(0,0,0,0.1)'
        }}>
          <h4 style={{ margin: '0 0 10px 0', fontSize: '16px' }}>🎯 Most Consistent</h4>
          <div style={{ fontSize: '24px', fontWeight: 'bold', marginBottom: '5px' }}>
            {smallestGap.performance_gap.toFixed(2)}
          </div>
          <div style={{ fontSize: '14px', opacity: 0.9 }}>
            {smallestGap.state_name}
          </div>
        </div>
      </div>
    );
  };

  const renderControlPanel = () => {
    return (
      <div style={{
        background: 'white',
        border: '1px solid #dee2e6',
        borderRadius: '12px',
        padding: '20px',
        marginBottom: '20px',
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
            📊 Visualization Controls
          </h4>
        </div>

        <div style={{ 
          display: 'grid', 
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: '15px',
          alignItems: 'end'
        }}>
          {/* Chart Type Selector */}
          <div>
            <label style={{ fontWeight: 'bold', marginBottom: '5px', display: 'block', fontSize: '14px' }}>
              Chart Type:
            </label>
            <select
              value={chartType}
              onChange={(e) => setChartType(e.target.value)}
              style={{
                width: '100%',
                padding: '8px 12px',
                border: '1px solid #ced4da',
                borderRadius: '6px',
                fontSize: '14px'
              }}
            >
              <option value="performance_gap">Performance Gap</option>
              <option value="best_worst">Best vs Worst</option>
              <option value="trends">Annual Trends</option>
              <option value="radar_comparison">State Comparison</option>
              <option value="test">🧪 Test Chart</option>
            </select>
          </div>

          {/* Sort By Selector */}
          <div>
            <label style={{ fontWeight: 'bold', marginBottom: '5px', display: 'block', fontSize: '14px' }}>
              Sort By:
            </label>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              style={{
                width: '100%',
                padding: '8px 12px',
                border: '1px solid #ced4da',
                borderRadius: '6px',
                fontSize: '14px'
              }}
            >
              <option value="gap_desc">Largest Gap First</option>
              <option value="gap_asc">Smallest Gap First</option>
              <option value="best_desc">Best Performers First</option>
              <option value="worst_desc">Worst Performers First</option>
              <option value="alphabetical">Alphabetical</option>
            </select>
          </div>

          {/* Show Top N Selector */}
          <div>
            <label style={{ fontWeight: 'bold', marginBottom: '5px', display: 'block', fontSize: '14px' }}>
              Show States:
            </label>
            <select
              value={showTopStates}
              onChange={(e) => setShowTopStates(parseInt(e.target.value))}
              style={{
                width: '100%',
                padding: '8px 12px',
                border: '1px solid #ced4da',
                borderRadius: '6px',
                fontSize: '14px'
              }}
            >
              <option value={5}>Top 5</option>
              <option value={10}>Top 10</option>
              <option value={15}>Top 15</option>
              <option value={20}>Top 20</option>
              <option value={extremesData?.states_analyzed || 32}>All States</option>
            </select>
          </div>
        </div>

        {renderStateSelector()}
      </div>
    );
  };

  const renderAnalysisText = () => {
    if (!extremesData?.analysis) return null;

    return (
      <div style={{
        background: 'white',
        border: '1px solid #dee2e6',
        borderRadius: '12px',
        padding: '20px',
        marginTop: '20px',
        boxShadow: '0 2px 8px rgba(0,0,0,0.08)'
      }}>
        <h4 style={{
          color: '#495057',
          fontSize: '16px',
          fontWeight: '600',
          marginBottom: '15px'
        }}>
          📝 Detailed Analysis
        </h4>
        <div style={{
          lineHeight: '1.6',
          color: '#495057',
          whiteSpace: 'pre-line'
        }}>
          {extremesData.analysis}
        </div>
      </div>
    );
  };

  if (!extremesData) {
    return (
      <div style={{ 
        padding: '20px', 
        textAlign: 'center',
        color: '#6c757d'
      }}>
        No state-wise extremes data available
      </div>
    );
  }

  if (mapOnly) {
    return (
      <div style={{ padding: '20px' }}>
        {renderSummaryCards()}
        <div style={{
          background: 'white',
          border: '1px solid #dee2e6',
          borderRadius: '12px',
          padding: '20px',
          boxShadow: '0 2px 8px rgba(0,0,0,0.08)'
        }}>
          <h4 style={{
            color: '#495057',
            fontSize: '16px',
            fontWeight: '600',
            marginBottom: '15px'
          }}>
            🗺️ Geographic Distribution
          </h4>
          <StateWiseExtremesMap data={extremesData} />
        </div>
      </div>
    );
  }

  if (chartOnly) {
    return (
      <div style={{ 
        padding: '10px',
        width: '100%',
        height: '80vh',
        display: 'flex',
        flexDirection: 'column'
      }}>
        {/* Simple Chart Type Selector */}
        <div style={{
          marginBottom: '15px',
          display: 'flex',
          gap: '10px',
          justifyContent: 'center',
          flexWrap: 'wrap'
        }}>
          {[
            { key: 'performance_gap', label: '📊 Performance Gap' },
            { key: 'best_worst', label: '🏆 Best vs Worst' },
            { key: 'trends', label: '📈 Trends' },
            { key: 'radar_comparison', label: '🎯 Radar Comparison' }
          ].map(chart => (
            <button
              key={chart.key}
              onClick={() => setChartType(chart.key)}
              style={{
                padding: '8px 16px',
                borderRadius: '6px',
                border: chartType === chart.key ? '2px solid #007bff' : '1px solid #ccc',
                background: chartType === chart.key ? '#e3f2fd' : 'white',
                cursor: 'pointer',
                fontSize: '14px',
                fontWeight: chartType === chart.key ? 'bold' : 'normal'
              }}
            >
              {chart.label}
            </button>
          ))}
        </div>

        <div style={{
          flex: 1,
          minHeight: '600px',
          background: 'white',
          borderRadius: '8px',
          padding: '20px',
          boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
        }}>
          {/* State selector for radar comparison */}
          {chartType === 'radar_comparison' && renderStateSelector()}
          {renderChart()}
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: '20px' }}>
      {/* Header */}
      <div style={{ marginBottom: '20px' }}>
        <h3 style={{ 
          color: '#495057', 
          marginBottom: '10px',
          fontSize: '20px',
          fontWeight: '600'
        }}>
          🏆 State-wise Best & Worst Performers
        </h3>
        <div style={{ 
          color: '#6c757d',
          fontSize: '14px',
          marginBottom: '10px'
        }}>
          <strong>Indicator:</strong> {extremesData.indicator_full_name}
        </div>
        <div style={{ 
          color: '#6c757d',
          fontSize: '14px',
          display: 'flex',
          gap: '20px',
          flexWrap: 'wrap'
        }}>
          <span><strong>Year:</strong> {extremesData.year}</span>
          <span><strong>States:</strong> {extremesData.states_analyzed}</span>
          <span><strong>Total Districts:</strong> {extremesData.total_districts}</span>
          <span>
            <strong>Direction:</strong> {extremesData.higher_is_better ? 'Higher is Better' : 'Lower is Better'}
          </span>
        </div>
      </div>

      {/* Summary Cards */}
      {renderSummaryCards()}

      {/* Control Panel */}
      {renderControlPanel()}

      {/* Chart */}
      <div style={{
        background: 'white',
        border: '1px solid #dee2e6',
        borderRadius: '12px',
        padding: '20px',
        boxShadow: '0 2px 8px rgba(0,0,0,0.08)'
      }}>
        {processedData ? (
          renderChart()
        ) : (
          <div style={{
            textAlign: 'center',
            padding: '40px',
            color: '#6c757d'
          }}>
            <h4>⚠️ Chart Data Not Available</h4>
            <p>Unable to process state-wise extremes data for chart visualization.</p>
            <details style={{ marginTop: '20px', textAlign: 'left' }}>
              <summary style={{ cursor: 'pointer', fontWeight: 'bold' }}>Debug Information</summary>
              <pre style={{ 
                background: '#f8f9fa', 
                padding: '10px', 
                borderRadius: '4px',
                fontSize: '12px',
                overflow: 'auto',
                marginTop: '10px'
              }}>
                {JSON.stringify({
                  hasExtremesData: !!extremesData,
                  extremesDataKeys: extremesData ? Object.keys(extremesData) : 'no data',
                  hasStateResults: !!extremesData?.state_results,
                  stateResultsLength: extremesData?.state_results?.length,
                  firstStateResult: extremesData?.state_results?.[0] || 'no first state'
                }, null, 2)}
              </pre>
            </details>
          </div>
        )}
      </div>

      {/* Analysis Text */}
      {renderAnalysisText()}
    </div>
  );
};

export default StateWiseExtremes; 