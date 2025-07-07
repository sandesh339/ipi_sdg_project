import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Bar, Line, Doughnut, Radar } from 'react-chartjs-2';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import DataDebugger from './DataDebugger';

import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  LineElement,
  PointElement,
  RadialLinearScale,
  Filler,
  Title,
  Tooltip,
  Legend,
  ArcElement,
  BarController,
  LineController,
  DoughnutController
} from 'chart.js';

// Register Chart.js components
ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  LineElement,
  PointElement,
  RadialLinearScale,
  Filler,
  Title,
  Tooltip,
  Legend,
  ArcElement,
  BarController,
  LineController,
  DoughnutController
);

// Set Mapbox access token
mapboxgl.accessToken = "pk.eyJ1Ijoic2FuZGVzaDMzOSIsImEiOiJjbThqazJuaTYwaTlwMmtwdzU4NzUwN3YwIn0.Kc6gPcC0Jf2rSJN4ieeimA";

// Color schemes
const IMPROVEMENT_COLORS = {
  most_improved: '#28a745',
  least_improved: '#dc3545',
  neutral: '#6c757d',
  positive_change: '#20c997',
  negative_change: '#fd7e14'
};

// Map Component for Improvement Districts
const ImprovementDistrictsMap = ({ data, improvementType }) => {
  const mapContainer = useRef(null);
  const map = useRef(null);
  const [legend, setLegend] = useState(null);

  // Create legend control
  const createLegend = () => {
    const legendControl = {
      onAdd: function(map) {
        this._map = map;
        this._container = document.createElement('div');
        this._container.className = 'map-legend';
        this._container.style.backgroundColor = 'white';
        this._container.style.padding = '10px';
        this._container.style.borderRadius = '4px';
        this._container.style.boxShadow = '0 1px 4px rgba(0,0,0,0.2)';
        this._container.style.margin = '10px';
        this._container.innerHTML = `
          <h4 style="margin: 0 0 8px 0; font-size: 14px;">District Performance</h4>
          <div style="display: flex; align-items: center; margin-bottom: 4px;">
            <div style="width: 20px; height: 20px; background: ${IMPROVEMENT_COLORS.most_improved}; margin-right: 8px;"></div>
            <span style="font-size: 12px;">Improving Districts</span>
          </div>
          <div style="display: flex; align-items: center;">
            <div style="width: 20px; height: 20px; background: ${IMPROVEMENT_COLORS.least_improved}; margin-right: 8px;"></div>
            <span style="font-size: 12px;">Declining Districts</span>
          </div>
        `;
        return this._container;
      },

      onRemove: function() {
        this._container.parentNode.removeChild(this._container);
        this._map = undefined;
      }
    };

    return legendControl;
  };

  useEffect(() => {
    if (!data || map.current) return;

    console.log('Map initialization - Raw data received:', data);
    console.log('Boundary data exists at boundary_data:', !!data.boundary_data);
    console.log('Boundary data exists at result.boundary:', !!data.result?.boundary);
    console.log('Boundary data length (boundary_data):', data.boundary_data?.length);
    console.log('Boundary data length (result.boundary):', data.result?.boundary?.length);
    console.log('Districts data exists:', !!data.districts);
    console.log('Districts data length:', data.districts?.length);
    console.log('Sample boundary item (boundary_data):', data.boundary_data?.[0]);
    console.log('Sample boundary item (result.boundary):', data.result?.boundary?.[0]);
    console.log('Sample district item:', data.districts?.[0]);

    // Initialize map
    map.current = new mapboxgl.Map({
      container: mapContainer.current,
      style: 'mapbox://styles/mapbox/light-v11',
      center: [78.9629, 20.5937], // Center of India
      zoom: 4
    });

    map.current.on('load', () => {
      console.log('Map loaded successfully');
      
      // Check if we have boundary data - try both locations
      const boundaryData = data.result?.boundary || data.boundary_data || data.boundary || [];
      const districtsData = data.data || data.districts || [];
      
      console.log('Processing boundary data:', boundaryData.length, 'items');
      console.log('Processing districts data:', districtsData.length, 'items');
      console.log('Using boundary data from:', data.result?.boundary ? 'result.boundary' : 'boundary_data');

      if (boundaryData.length > 0) {
        // Create GeoJSON for improvement districts
        const features = [];
        
        boundaryData.forEach((boundary, index) => {
          console.log(`Processing boundary ${index}:`, boundary);
          
          const districtName = boundary.district || boundary.district_name;
          console.log(`District name from boundary: ${districtName}`);
          
          // Find matching district data with more flexible matching
          const districtData = districtsData.find(d => {
            const dName1 = (d.district_name || '').toLowerCase().trim();
            const dName2 = (d.district || '').toLowerCase().trim();
            const bName = (districtName || '').toLowerCase().trim();
            
            const match1 = dName1 === bName;
            const match2 = dName2 === bName;
            const match3 = dName1.includes(bName) || bName.includes(dName1);
            const match4 = dName2.includes(bName) || bName.includes(dName2);
            
            return match1 || match2 || match3 || match4;
          });
          
          if (districtData) {
            // Get the actual indicator for this district
            const indicatorName = districtData.indicator_name || districtData.indicator || 'N/A';
            const improvementScore = districtData.improvement_score || 
                                   districtData.actual_annual_change || 
                                   districtData.annual_change || 
                                   districtData.change_value || 0;
            
            const nfhs4Value = districtData.nfhs_4_value || 0;
            const nfhs5Value = districtData.nfhs_5_value || districtData.current_value || 0;
            const annualChange = districtData.actual_annual_change || 
                               districtData.annual_change || 
                               districtData.change_value || 0;

            const feature = {
              type: 'Feature',
              properties: {
                district_name: districtName,
                state_name: boundary.state || districtData.state_name || 'Unknown',
                improvement_score: improvementScore,
                current_value: nfhs5Value,
                annual_change: annualChange,
                indicator: indicatorName,
                nfhs_4_value: nfhs4Value,
                nfhs_5_value: nfhs5Value,
                is_positive: improvementScore > 0,
                rank: districtData.rank || 0,
                has_data: true
              },
              geometry: boundary.geometry || boundary.boundary
            };
            
            features.push(feature);
          } else {
            // Add feature with no data
            const feature = {
              type: 'Feature',
              properties: {
                district_name: districtName,
                state_name: boundary.state || 'Unknown',
                has_data: false
              },
              geometry: boundary.geometry || boundary.boundary
            };
            
            features.push(feature);
          }
        });

        const improvementGeoJSON = {
          type: 'FeatureCollection',
          features: features
        };

        console.log('Final GeoJSON created with', features.length, 'features');
        console.log('Sample feature:', features[0]);

        if (features.length > 0) {
          // Add source
          map.current.addSource('improvement-districts', {
            type: 'geojson',
            data: improvementGeoJSON
          });

          console.log('Added GeoJSON source');

          // Add fill layer
          map.current.addLayer({
            id: 'improvement-districts-fill',
            type: 'fill',
            source: 'improvement-districts',
            paint: {
              'fill-color': [
                'case',
                ['>', ['get', 'improvement_score'], 0],
                IMPROVEMENT_COLORS.most_improved,
                IMPROVEMENT_COLORS.least_improved
              ],
              'fill-opacity': 0.7
            }
          });

          console.log('Added fill layer');

          // Add stroke layer
          map.current.addLayer({
            id: 'improvement-districts-stroke',
            type: 'line',
            source: 'improvement-districts',
            paint: {
              'line-color': '#ffffff',
              'line-width': 1.5
            }
          });

          console.log('Added stroke layer');

          // Add hover effect
          map.current.addLayer({
            id: 'improvement-districts-hover',
            type: 'fill',
            source: 'improvement-districts',
            paint: {
              'fill-color': '#000000',
              'fill-opacity': [
                'case',
                ['boolean', ['feature-state', 'hover'], false],
                0.2,
                0
              ]
            }
          });

          let hoveredStateId = null;

          // Handle hover states
          map.current.on('mousemove', 'improvement-districts-fill', (e) => {
            if (e.features.length > 0) {
              if (hoveredStateId !== null) {
                map.current.setFeatureState(
                  { source: 'improvement-districts', id: hoveredStateId },
                  { hover: false }
                );
              }
              hoveredStateId = e.features[0].id;
              map.current.setFeatureState(
                { source: 'improvement-districts', id: hoveredStateId },
                { hover: true }
              );
            }
          });

          // Add popups
          map.current.on('click', 'improvement-districts-fill', (e) => {
            const properties = e.features[0].properties;
            
            // Determine status and colors
            const hasData = properties.has_data;
            const isPositive = properties.is_positive;
            const statusColor = hasData ? 
              (isPositive ? IMPROVEMENT_COLORS.most_improved : IMPROVEMENT_COLORS.least_improved) : 
              '#6c757d';
            const statusText = hasData ? 
              (isPositive ? '📈 Improving District' : '📉 Declining District') : 
              '📊 No Performance Data';
            
            const popupContent = `
              <div style="font-family: Arial, sans-serif; max-width: 320px; padding: 12px;">
                <h3 style="margin: 0 0 10px 0; color: ${statusColor}; font-size: 16px; font-weight: bold;">
                  ${properties.district_name}
                </h3>
                <div style="background: ${hasData ? (isPositive ? 'rgba(40, 167, 69, 0.1)' : 'rgba(220, 53, 69, 0.1)') : 'rgba(108, 117, 125, 0.1)'}; padding: 8px; border-radius: 4px; margin-bottom: 12px;">
                  <strong style="color: ${statusColor}; font-size: 14px;">
                    ${statusText}
                  </strong>
                </div>
                
                <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
                  <tr>
                    <td style="padding: 6px 0; color: #666; font-weight: 500;">State:</td>
                    <td style="padding: 6px 0; font-weight: 600;">${properties.state_name}</td>
                  </tr>
                  ${hasData ? `
                  <tr>
                    <td style="padding: 6px 0; color: #666; font-weight: 500;">Indicator:</td>
                    <td style="padding: 6px 0; font-weight: 600; font-size: 12px;">${properties.indicator}</td>
                  </tr>
                  <tr>
                    <td style="padding: 6px 0; color: #666; font-weight: 500;">NFHS-4 (2016):</td>
                    <td style="padding: 6px 0; font-weight: 600;">${parseFloat(properties.nfhs_4_value || 0).toFixed(2)}%</td>
                  </tr>
                  <tr>
                    <td style="padding: 6px 0; color: #666; font-weight: 500;">NFHS-5 (2021):</td>
                    <td style="padding: 6px 0; font-weight: 600;">${parseFloat(properties.nfhs_5_value || 0).toFixed(2)}%</td>
                  </tr>
                  <tr>
                    <td style="padding: 6px 0; color: #666; font-weight: 500;">Annual Change:</td>
                    <td style="padding: 6px 0; font-weight: 600; color: ${statusColor};">
                      ${parseFloat(properties.annual_change || 0) > 0 ? '+' : ''}${parseFloat(properties.annual_change || 0).toFixed(2)}% per year
                    </td>
                  </tr>
                  <tr>
                    <td style="padding: 6px 0; color: #666; font-weight: 500;">Improvement Score:</td>
                    <td style="padding: 6px 0; font-weight: 600; color: ${statusColor};">
                      ${parseFloat(properties.improvement_score || 0).toFixed(3)}
                    </td>
                  </tr>
                  ${properties.rank > 0 ? `
                  <tr>
                    <td style="padding: 6px 0; color: #666; font-weight: 500;">Rank:</td>
                    <td style="padding: 6px 0; font-weight: 600;">#${properties.rank}</td>
                  </tr>
                  ` : ''}
                  ` : `
                  <tr>
                    <td colspan="2" style="padding: 12px 0; text-align: center; color: #6c757d; font-style: italic;">
                      No improvement data available for this district
                    </td>
                  </tr>
                  `}
                </table>
                
                ${hasData ? `
                <div style="margin-top: 10px; padding: 8px; background: #f8f9fa; border-radius: 4px; border-left: 4px solid ${statusColor};">
                  <div style="font-size: 12px; color: #495057;">
                    <strong>Trend:</strong> ${parseFloat(properties.annual_change || 0) > 0 ? 'Improving' : parseFloat(properties.annual_change || 0) < 0 ? 'Declining' : 'Stable'} 
                    (${Math.abs(parseFloat(properties.annual_change || 0)).toFixed(2)}% change per year)
                  </div>
                </div>
                ` : ''}
              </div>
            `;

            new mapboxgl.Popup()
              .setLngLat(e.lngLat)
              .setHTML(popupContent)
              .addTo(map.current);
          });

          // Change cursor on hover
          map.current.on('mouseenter', 'improvement-districts-fill', () => {
            map.current.getCanvas().style.cursor = 'pointer';
          });

          map.current.on('mouseleave', 'improvement-districts-fill', () => {
            map.current.getCanvas().style.cursor = '';
            if (hoveredStateId !== null) {
              map.current.setFeatureState(
                { source: 'improvement-districts', id: hoveredStateId },
                { hover: false }
              );
            }
            hoveredStateId = null;
          });

          // Add legend
          const legend = createLegend();
          map.current.addControl(legend, 'top-right');
          setLegend(legend);
          
          console.log('Map setup completed successfully');
        } else {
          console.error('No features created - check geometry data');
        }
      } else {
        console.error('No boundary data available');
      }
    });

    return () => {
      if (map.current) {
        if (legend) {
          map.current.removeControl(legend);
        }
        map.current.remove();
        map.current = null;
      }
    };
  }, [data, improvementType]);

  return (
    <div style={{ height: '100vh', width: '100%', position: 'relative' }}>
      <div ref={mapContainer} style={{ height: '100%', width: '100%' }} />
    </div>
  );
};

const ImprovementDistrictsAnalysis = ({ improvementData, mapOnly = false, chartOnly = false }) => {
  console.log('ImprovementDistrictsAnalysis received data:', {
    improvementData,
    type: typeof improvementData,
    keys: improvementData ? Object.keys(improvementData) : 'no data',
    districts: improvementData?.districts,
    districtsLength: improvementData?.districts?.length,
    sampleDistrict: improvementData?.districts?.[0]
  });

  const [chartType, setChartType] = useState('improvement_ranking');
  const [selectedIndicators, setSelectedIndicators] = useState([]);
  const [sortBy, setSortBy] = useState('improvement_score');
  const [showTopDistricts, setShowTopDistricts] = useState(15);

  // Process the data when it changes
  const processedData = useMemo(() => {
    if (!improvementData || !improvementData.districts || improvementData.districts.length === 0) {
      console.log('No data available for processing');
      return null;
    }

    console.log('Processing improvement data:', improvementData);

    const allDistricts = improvementData.districts;
    
    // Group districts by indicators
    const indicatorGroups = allDistricts.reduce((acc, district) => {
      const indicator = district.indicator_name || district.indicator || 'Unknown';
      if (!acc[indicator]) {
        acc[indicator] = [];
      }
      acc[indicator].push(district);
      return acc;
    }, {});

    console.log('Indicator groups:', indicatorGroups);

    // Calculate indicator distribution
    const indicators = Object.entries(indicatorGroups).reduce((acc, [indicator, districts]) => {
      acc[indicator] = districts.length;
      return acc;
    }, {});

    console.log('Calculated indicators distribution:', indicators);

    // Sort districts by improvement score
    const sortedDistricts = [...allDistricts].sort((a, b) => {
      const scoreA = parseFloat(a.improvement_score || a.actual_annual_change || 0);
      const scoreB = parseFloat(b.improvement_score || b.actual_annual_change || 0);
      return scoreB - scoreA;
    });

    return {
      all: allDistricts,
      sorted: sortedDistricts,
      top: sortedDistricts.slice(0, 10),
      bottom: sortedDistricts.slice(-10),
      indicators: indicators,
      totalDistricts: allDistricts.length
    };
  }, [improvementData]);

  const radarOptions = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: 'top',
        labels: {
          padding: 20,
          font: { size: 12 },
          usePointStyle: true,
          pointStyle: 'circle'
        }
      },
      title: {
        display: true,
        text: `Worst Performing Districts - SDG ${improvementData?.sdg_goal || ''}`,
        font: { size: 16, weight: 'bold' },
        padding: { bottom: 20 }
      },
      tooltip: {
        callbacks: {
          label: function(context) {
            const label = context.dataset.label || '';
            const indicator = context.label;
            
            // Find the specific district and indicator data
            const districtData = processedData.all.find(d => 
              (d.district_name === label || d.district === label) && 
              (d.indicator_name === indicator || d.indicator === indicator)
            );

            if (!districtData) {
              return `${label} - ${indicator}: No data`;
            }

            const isLowerBetter = districtData.higher_is_better === false;
            const value = parseFloat(districtData.nfhs_5_value || districtData.current_value || 0);
            const actualValue = isLowerBetter ? (100 - context.raw).toFixed(1) : context.raw.toFixed(1);
            const trend = parseFloat(districtData.actual_annual_change || 0).toFixed(2);
            const trendSymbol = parseFloat(trend) > 0 ? '↑' : '↓';
            
            return `${label} - ${indicator}: ${actualValue}% (${trendSymbol} ${Math.abs(trend)}% per year)`;
          }
        }
      }
    },
    scales: {
      r: {
        beginAtZero: true,
        min: 0,
        max: 100,
        ticks: {
          stepSize: 20,
          callback: function(value) {
            return value + '%';
          }
        },
        pointLabels: {
          font: { size: 12, weight: 'bold' }
        },
        grid: {
          circular: true
        }
      }
    }
  }), [improvementData, processedData]);

  // Color schemes
  const CHART_COLORS = {
    improvement: '#28a745',
    decline: '#dc3545',
    neutral: '#6c757d',
    background: 'rgba(40, 167, 69, 0.2)',
    border: 'rgba(40, 167, 69, 1)'
  };

  // Chart options for different chart types
  const chartOptions = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: 'top',
        labels: {
          padding: 20,
          font: {
            size: 12
          }
        }
      },
      title: {
        display: true,
        text: chartType === 'indicator_distribution' ? 'Distribution of Indicators' : 'District Performance Analysis',
        font: {
          size: 16,
          weight: 'bold'
        },
        padding: {
          bottom: 20
        }
      },
      tooltip: {
        callbacks: {
          label: function(context) {
            const label = context.label || '';
            const value = context.raw || 0;
            return `${label}: ${value} districts`;
          }
        }
      }
    },
    layout: {
      padding: 20
    }
  }), [chartType]);

  // Chart generation functions
  const generateImprovementRankingChart = () => {
    if (!processedData || !processedData.top) {
      console.log('No processed data available for improvement ranking chart');
      return null;
    }

    const data = processedData.top.slice(0, 10); // Top 10 for readability
    
    // Extract and validate values
    const districts = data.map(d => d.district_name || d.district || d.name || 'Unknown');
    const annualChanges = data.map(d => {
      const possibleFields = ['actual_annual_change', 'annual_change', 'change_value', 'improvement_score'];
      let val = null;
      for (const field of possibleFields) {
        if (d[field] !== undefined && d[field] !== null) {
          val = parseFloat(d[field]);
          console.log(`Found annual change in field '${field}' for ${d.district_name}: ${d[field]} -> ${val}`);
          break;
        }
      }
      if (val === null) {
        console.log(`No valid annual change found for ${d.district_name}`, d);
        return 0;
      }
      return isNaN(val) ? 0 : val;
    });

    // Check if we have valid data
    const hasValidData = annualChanges.some(v => v !== 0);
    if (!hasValidData) {
      console.log('No valid data found for improvement ranking chart');
      return null;
    }

    return {
      labels: districts,
      datasets: [
        {
          label: 'Annual Change',
          data: annualChanges,
          backgroundColor: annualChanges.map(val => 
            val > 0 ? 'rgba(40, 167, 69, 0.5)' : 'rgba(220, 53, 69, 0.5)'
          ),
          borderColor: annualChanges.map(val => 
            val > 0 ? 'rgba(40, 167, 69, 1)' : 'rgba(220, 53, 69, 1)'
          ),
          borderWidth: 1,
          barPercentage: 0.6,
          categoryPercentage: 0.7,
          maxBarThickness: 50
        }
      ]
    };
  };

  const generateIndicatorDistributionChart = () => {
    if (!processedData || !processedData.all || processedData.all.length === 0) {
      console.log('No data available for indicator distribution chart');
      return null;
    }

    // Calculate indicator distribution directly from districts
    const indicatorCounts = processedData.all.reduce((acc, district) => {
      const indicator = district.indicator_name || district.indicator || 'Unknown';
      if (indicator && indicator !== 'Unknown') {
        acc[indicator] = (acc[indicator] || 0) + 1;
      }
      return acc;
    }, {});

    const indicators = Object.keys(indicatorCounts);
    const counts = Object.values(indicatorCounts);

    if (indicators.length === 0) {
      console.log('No indicators found for distribution chart');
      return null;
    }

    console.log('Indicator distribution data:', {
      indicators,
      counts,
      total: counts.reduce((a, b) => a + b, 0)
    });

    // Use fixed colors for better visibility
    const colors = [
      'rgba(255, 99, 132, 0.8)',   // Pink
      'rgba(54, 162, 235, 0.8)',   // Blue
      'rgba(255, 206, 86, 0.8)',   // Yellow
      'rgba(75, 192, 192, 0.8)',   // Teal
      'rgba(153, 102, 255, 0.8)',  // Purple
      'rgba(255, 159, 64, 0.8)',   // Orange
    ];

    return {
      labels: indicators,
      datasets: [{
        data: counts,
        backgroundColor: colors.slice(0, indicators.length),
        borderColor: colors.slice(0, indicators.length).map(color => color.replace('0.8)', '1)')),
        borderWidth: 1
      }]
    };
  };

  const generateTrendAnalysisChart = () => {
    if (!processedData || !processedData.top) {
      console.log('No processed data available for trend analysis chart');
      return null;
    }

    const data = processedData.top.slice(0, 5); // Top 5 for better readability
    
    // Use actual NFHS-4 (2016) and NFHS-5 (2021) years
    const years = [2016, 2021];
    
    // Use actual NFHS-4 and NFHS-5 values from the data
    const datasets = data.map((district, index) => {
      // Get the actual NFHS-4 (2016) and NFHS-5 (2021) values
      const value2016 = parseFloat(district.nfhs_4_value || 0);
      const value2021 = parseFloat(district.nfhs_5_value || district.current_value || 0);
      
      const colors = [
        { bg: 'rgba(255, 99, 132, 0.2)', border: 'rgba(255, 99, 132, 1)' },
        { bg: 'rgba(54, 162, 235, 0.2)', border: 'rgba(54, 162, 235, 1)' },
        { bg: 'rgba(255, 206, 86, 0.2)', border: 'rgba(255, 206, 86, 1)' },
        { bg: 'rgba(75, 192, 192, 0.2)', border: 'rgba(75, 192, 192, 1)' },
        { bg: 'rgba(153, 102, 255, 0.2)', border: 'rgba(153, 102, 255, 1)' }
      ];

      return {
        label: district.district_name || district.district || district.name || 'Unknown',
        data: [value2016, value2021],
        borderColor: colors[index].border,
        backgroundColor: colors[index].bg,
        fill: false,
        tension: 0.4,
        pointRadius: 4,
        pointHoverRadius: 6
      };
    });

    return {
      labels: years,
      datasets
    };
  };

  const generateComparisonRadarChart = () => {
    if (!processedData || !processedData.all || processedData.all.length < 2) {
      console.log('Not enough data for radar comparison');
      return null;
    }

    // Group districts by their names to get all indicators for each district
    const districtGroups = processedData.all.reduce((acc, district) => {
      const name = district.district_name || district.district || 'Unknown';
      if (!acc[name]) {
        acc[name] = [];
      }
      acc[name].push(district);
      return acc;
    }, {});

    // Get unique indicators and worst performing districts
    const uniqueIndicators = [...new Set(processedData.all.map(d => 
      d.indicator_name || d.indicator || 'Unknown'
    ))].filter(ind => ind !== 'Unknown');

    // Get the worst performing districts (up to 6)
    const worstDistrictNames = [...new Set(processedData.sorted.slice(-6).map(d => 
      d.district_name || d.district || 'Unknown'
    ))];

    console.log('Preparing radar chart data:', {
      uniqueIndicators,
      worstDistrictNames,
      districtGroups
    });
    
    // Generate datasets for each district
    const datasets = worstDistrictNames.map((districtName, index) => {
      const districtData = districtGroups[districtName] || [];
      
      // Get values for each indicator
      const values = uniqueIndicators.map(indicator => {
        const indicatorData = districtData.find(d => 
          (d.indicator_name || d.indicator) === indicator
        );

        if (!indicatorData) {
          console.log(`No data found for district ${districtName} indicator ${indicator}`);
          return 0;
        }

        const value = parseFloat(indicatorData.nfhs_5_value || indicatorData.current_value || 0);
        
        // For indicators where lower is better, invert the value for visualization
        const isLowerBetter = indicatorData.higher_is_better === false;
        return isLowerBetter ? (100 - value) : value;
      });

      // Define colors for better visibility
      const colors = [
        { bg: 'rgba(255, 99, 132, 0.2)', border: 'rgb(255, 99, 132)' },   // Red
        { bg: 'rgba(54, 162, 235, 0.2)', border: 'rgb(54, 162, 235)' },   // Blue
        { bg: 'rgba(255, 206, 86, 0.2)', border: 'rgb(255, 206, 86)' },   // Yellow
        { bg: 'rgba(75, 192, 192, 0.2)', border: 'rgb(75, 192, 192)' },   // Teal
        { bg: 'rgba(153, 102, 255, 0.2)', border: 'rgb(153, 102, 255)' }, // Purple
        { bg: 'rgba(255, 159, 64, 0.2)', border: 'rgb(255, 159, 64)' }    // Orange
      ];

      return {
        label: districtName,
        data: values,
        backgroundColor: colors[index].bg,
        borderColor: colors[index].border,
        borderWidth: 2,
        pointBackgroundColor: colors[index].border,
        pointBorderColor: '#fff',
        pointHoverBackgroundColor: '#fff',
        pointHoverBorderColor: colors[index].border,
        pointRadius: 4,
        pointHoverRadius: 6
      };
    });

    return {
      labels: uniqueIndicators,
      datasets: datasets
    };
  };

  const renderChart = () => {
    console.log('Rendering chart with type:', chartType);
    
    if (!processedData) {
      console.log('No processed data available for rendering');
      return (
        <div style={{ textAlign: 'center', padding: '40px', color: '#666' }}>
          <p>No improvement data available for visualization.</p>
        </div>
      );
    }

    let chartData;
    let ChartComponent;

    switch (chartType) {
      case 'improvement_ranking':
        chartData = generateImprovementRankingChart();
        ChartComponent = Bar;
        break;
      case 'indicator_distribution':
        chartData = generateIndicatorDistributionChart();
        ChartComponent = Doughnut;
        break;
      case 'trend_analysis':
        chartData = generateTrendAnalysisChart();
        ChartComponent = Line;
        break;
      case 'radar_comparison':
        chartData = generateComparisonRadarChart();
        ChartComponent = Radar;
        break;
      default:
        chartData = generateImprovementRankingChart();
        ChartComponent = Bar;
    }

    console.log('Chart data prepared:', chartData);

    if (!chartData) {
      return (
        <div style={{ textAlign: 'center', padding: '40px', color: '#888' }}>
          <p>No data available for this chart type.</p>
        </div>
      );
    }

    return (
      <div style={{ height: '500px', width: '100%', position: 'relative' }}>
        <ChartComponent 
          data={chartData} 
          options={chartType === 'radar_comparison' ? radarOptions : chartOptions}
        />
      </div>
    );
  };

  const renderSummaryCards = () => {
    if (!processedData) return null;

    const totalDistricts = processedData.totalDistricts;
    const averageChange = processedData.all.reduce((sum, d) => 
      sum + (d.actual_annual_change || 0), 0) / totalDistricts;
    const positiveCount = processedData.all.filter(d => 
      (d.improvement_score || d.actual_annual_change || 0) > 0).length;
    const indicatorCount = Object.keys(processedData.indicators || {}).length;

    return (
      <div style={{ 
        display: 'grid', 
        gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', 
        gap: '16px', 
        marginBottom: '24px' 
      }}>
        <div style={{ 
          background: 'linear-gradient(135deg, #e8f5e8 0%, #d4edda 100%)',
          padding: '20px', 
          borderRadius: '12px', 
          border: '1px solid #c3e6cb',
          textAlign: 'center'
        }}>
          <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#155724' }}>
            {totalDistricts}
          </div>
          <div style={{ fontSize: '14px', color: '#155724', marginTop: '4px' }}>
            Total Districts
          </div>
        </div>
        
        <div style={{ 
          background: 'linear-gradient(135deg, #e1ecf4 0%, #bee5eb 100%)',
          padding: '20px', 
          borderRadius: '12px', 
          border: '1px solid #abdde5',
          textAlign: 'center'
        }}>
          <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#0c5460' }}>
            {averageChange.toFixed(2)}
          </div>
          <div style={{ fontSize: '14px', color: '#0c5460', marginTop: '4px' }}>
            Average Change
          </div>
        </div>
        
        <div style={{ 
          background: 'linear-gradient(135deg, #fff3cd 0%, #ffeaa7 100%)',
          padding: '20px', 
          borderRadius: '12px', 
          border: '1px solid #ffc107',
          textAlign: 'center'
        }}>
          <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#856404' }}>
            {positiveCount}
          </div>
          <div style={{ fontSize: '14px', color: '#856404', marginTop: '4px' }}>
            Improving Districts
          </div>
        </div>
        
        <div style={{ 
          background: 'linear-gradient(135deg, #f8d7da 0%, #f5c6cb 100%)',
          padding: '20px', 
          borderRadius: '12px', 
          border: '1px solid #f5c6cb',
          textAlign: 'center'
        }}>
          <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#721c24' }}>
            {indicatorCount}
          </div>
          <div style={{ fontSize: '14px', color: '#721c24', marginTop: '4px' }}>
            Indicators Analyzed
          </div>
        </div>
      </div>
    );
  };

  const renderAnalysisText = () => {
    if (!processedData || !processedData.analysis) return null;

    return (
      <div style={{ 
        background: '#e7f3ff', 
        padding: '20px', 
        borderRadius: '12px', 
        marginBottom: '24px',
        border: '1px solid #b3d9ff'
      }}>
        <h4 style={{ margin: '0 0 12px 0', color: '#0056b3', display: 'flex', alignItems: 'center', gap: '8px' }}>
          🧠 AI Analysis
        </h4>
        <div style={{ color: '#004085', lineHeight: '1.6', fontSize: '15px' }}>
          {processedData.analysis}
        </div>
      </div>
    );
  };

  if (mapOnly) {
    return (
      <div style={{ width: '100%', height: '100%' }}>
        <ImprovementDistrictsMap 
          data={improvementData}
          improvementType={improvementData.query_type}
        />
      </div>
    );
  }

  if (chartOnly) {
    return (
      <div style={{ width: '100%', height: '100%', padding: '20px' }}>
        {/* Chart Controls without Show Top Districts */}
        <div style={{ 
          background: '#f8f9fa', 
          padding: '20px', 
          borderRadius: '12px', 
          marginBottom: '24px',
          border: '1px solid #dee2e6'
        }}>
          <h4 style={{ margin: '0 0 16px 0', color: '#495057' }}>Chart Controls</h4>
          <div style={{ 
            display: 'grid', 
            gridTemplateColumns: '1fr', 
            gap: '16px' 
          }}>
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
                <option value="improvement_ranking">Improvement Ranking</option>
                <option value="indicator_distribution">Indicator Distribution</option>
                <option value="trend_analysis">Trend Analysis</option>
                <option value="radar_comparison">Radar Comparison</option>
              </select>
            </div>
          </div>
        </div>
        {renderChart()}
      </div>
    );
  }

  if (!processedData) {
    return <div>Loading...</div>;
  }

  return (
    <div className="improvement-analysis-container">
      <div style={{ marginBottom: '32px' }}>
        <h3 style={{ marginBottom: '16px', color: '#495057' }}>📈 Performance Trends</h3>
        <div className="chart-container">
          <Line data={generateTrendAnalysisChart()} options={radarOptions} />
        </div>
      </div>

      <div style={{ marginBottom: '32px' }}>
        <h3 style={{ marginBottom: '16px', color: '#495057' }}>📊 Annual Change Distribution</h3>
        <div className="chart-container">
          <Bar data={generateIndicatorDistributionChart()} options={chartOptions} />
        </div>
      </div>

      <div style={{ marginBottom: '32px' }}>
        <h3 style={{ marginBottom: '16px', color: '#495057' }}>🗺️ Geographic Distribution</h3>
        <div className="map-container">
          <ImprovementDistrictsMap 
            data={improvementData}
            improvementType={improvementData.query_type}
          />
        </div>
      </div>
    </div>
  );
};

export default ImprovementDistrictsAnalysis; 