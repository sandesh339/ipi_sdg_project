import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Bar, Line, Scatter } from 'react-chartjs-2';
import mapboxgl from 'mapbox-gl';
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
  Legend
} from 'chart.js';

// Register Chart.js components
ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  LineElement,
  PointElement,
  Title,
  Tooltip,
  Legend
);

// Set Mapbox access token
mapboxgl.accessToken = "pk.eyJ1Ijoic2FuZGVzaDMzOSIsImEiOiJjbThqazJuaTYwaTlwMmtwdzU4NzUwN3YwIn0.Kc6gPcC0Jf2rSJN4ieeimA";

// Color schemes for radius analysis
const RADIUS_COLORS = {
  center: '#e74c3c',          // Red for center point
  radius_circle: '#3498db',   // Blue for radius circle
  district_good: '#27ae60',   // Green for good performance
  district_poor: '#e67e22',   // Orange for poor performance
  district_avg: '#95a5a6',    // Gray for average performance
  improvement: '#2ecc71',     // Green for improvement
  decline: '#e74c3c'          // Red for decline
};

// Generate distinct colors for different states
const generateStateColors = () => {
  const colorPalette = [
    '#3498db', '#e74c3c', '#2ecc71', '#f39c12', '#9b59b6',
    '#1abc9c', '#e67e22', '#34495e', '#f1c40f', '#8e44ad',
    '#16a085', '#27ae60', '#d35400', '#2c3e50', '#c0392b'
  ];
  
  return (index) => colorPalette[index % colorPalette.length];
};

// Map Component for Radius Analysis
const RadiusAnalysisMap = ({ data, fullScreen = false }) => {
  const mapContainer = useRef(null);
  const map = useRef(null);

  useEffect(() => {
    if (!data || !data.boundary_data || map.current) return;

    console.log('Initializing radius analysis map with data:', data);
    console.log('Sample boundary_data:', data.boundary_data[0]);

    // Determine center coordinates
    let centerCoords;
    if (data.center_coordinates) {
      // Use provided center coordinates (works for both coordinates and district center types)
      centerCoords = [data.center_coordinates.lng, data.center_coordinates.lat];
    } else if (data.center_type === 'coordinates') {
      centerCoords = [data.center_coordinates.lng, data.center_coordinates.lat];
    } else {
      // Find center district in boundary data
      const centerDistrict = data.boundary_data.find(b => 
        b.district === data.center_point || b.district_name === data.center_point
      );
      if (centerDistrict && centerDistrict.centroid) {
        centerCoords = centerDistrict.centroid.coordinates;
      } else {
        centerCoords = [78.9629, 20.5937]; // Default to center of India
      }
    }

    // Initialize map
    map.current = new mapboxgl.Map({
      container: mapContainer.current,
      style: 'mapbox://styles/mapbox/light-v11',
      center: centerCoords,
      zoom: 7
    });

    map.current.on('load', () => {
      // Add radius circle using a simple approach
      const radiusInDegrees = data.radius_km / 111; // Rough conversion km to degrees
      const circleCoords = [];
      const steps = 64;
      
      for (let i = 0; i <= steps; i++) {
        const angle = (i * 360) / steps;
        const x = centerCoords[0] + radiusInDegrees * Math.cos(angle * Math.PI / 180);
        const y = centerCoords[1] + radiusInDegrees * Math.sin(angle * Math.PI / 180);
        circleCoords.push([x, y]);
      }

      const circle = {
        type: 'Feature',
        geometry: {
          type: 'Polygon',
          coordinates: [circleCoords]
        }
      };

      map.current.addSource('radius-circle', {
        type: 'geojson',
        data: circle
      });

      map.current.addLayer({
        id: 'radius-circle-fill',
        type: 'fill',
        source: 'radius-circle',
        paint: {
          'fill-color': RADIUS_COLORS.radius_circle,
          'fill-opacity': 0.1
        }
      });

      map.current.addLayer({
        id: 'radius-circle-stroke',
        type: 'line',
        source: 'radius-circle',
        paint: {
          'line-color': RADIUS_COLORS.radius_circle,
          'line-width': 3,
          'line-dasharray': [2, 2]
        }
      });

      // Add center point marker
      map.current.addSource('center-point', {
        type: 'geojson',
        data: {
          type: 'Feature',
          geometry: {
            type: 'Point',
            coordinates: centerCoords
          },
          properties: {
            title: data.center_point,
            type: 'center'
          }
        }
      });

      map.current.addLayer({
        id: 'center-point',
        type: 'circle',
        source: 'center-point',
        paint: {
          'circle-color': RADIUS_COLORS.center,
          'circle-radius': 8,
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 2
        }
      });

      // Create GeoJSON for districts within radius
      const stateColorGenerator = generateStateColors();
      const allStates = [...new Set(data.districts.map(d => d.state_name))];
      const stateColors = {};
      allStates.forEach((state, index) => {
        stateColors[state] = stateColorGenerator(index);
      });

      // Only include boundaries with valid geometry
      const districtsGeoJSON = {
        type: 'FeatureCollection',
        features: data.boundary_data
          .filter(boundary => boundary.geometry && boundary.geometry.type && boundary.geometry.coordinates)
          .map((boundary) => {
            const districtData = data.districts.find(d => 
              d.district_name === boundary.district || d.district_name === boundary.district_name
            );
            let performanceScore = 50;
            if (districtData) {
              if (districtData.overall_performance_2021 !== undefined) {
                performanceScore = districtData.overall_performance_2021;
              } else if (districtData.overall_performance !== undefined) {
                performanceScore = districtData.overall_performance;
              }
            }
            return {
              type: 'Feature',
              properties: {
                district_name: boundary.district || boundary.district_name,
                state_name: boundary.state || boundary.state_name,
                distance_km: districtData?.distance_km || 0,
                performance_score: performanceScore,
                state_color: stateColors[boundary.state || boundary.state_name] || '#cccccc',
                has_data: !!districtData
              },
              geometry: boundary.geometry
            };
          })
      };

      console.log('districtsGeoJSON', districtsGeoJSON);

      // Add districts source
      map.current.addSource('radius-districts', {
        type: 'geojson',
        data: districtsGeoJSON
      });

      // For debugging: set fill color to solid red
      map.current.addLayer({
        id: 'radius-districts-fill',
        type: 'fill',
        source: 'radius-districts',
        paint: {
          'fill-color': '#ff0000',
          'fill-opacity': 0.5
        }
      });

      // Build state-based color expression
      const colorExpression = ['case'];
      allStates.forEach(state => {
        colorExpression.push(['==', ['get', 'state_name'], state]);
        colorExpression.push(stateColors[state]);
      });
      colorExpression.push('#cccccc'); // Default color

      // Add district fill layer with state-based coloring
      map.current.addLayer({
        id: 'radius-districts-fill',
        type: 'fill',
        source: 'radius-districts',
        paint: {
          'fill-color': colorExpression,
          'fill-opacity': 0.7
        }
      });

      // Add district stroke layer
      map.current.addLayer({
        id: 'radius-districts-stroke',
        type: 'line',
        source: 'radius-districts',
        paint: {
          'line-color': '#ffffff',
          'line-width': 2
        }
      });

      // Add hover effect
      map.current.addLayer({
        id: 'radius-districts-hover',
        type: 'fill',
        source: 'radius-districts',
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
      map.current.on('mousemove', 'radius-districts-fill', (e) => {
        if (e.features.length > 0) {
          if (hoveredStateId !== null) {
            map.current.setFeatureState(
              { source: 'radius-districts', id: hoveredStateId },
              { hover: false }
            );
          }
          hoveredStateId = e.features[0].id;
          map.current.setFeatureState(
            { source: 'radius-districts', id: hoveredStateId },
            { hover: true }
          );
        }
      });

      map.current.on('mouseleave', 'radius-districts-fill', () => {
        if (hoveredStateId !== null) {
          map.current.setFeatureState(
            { source: 'radius-districts', id: hoveredStateId },
            { hover: false }
          );
        }
        hoveredStateId = null;
      });

      // Add popup on click
      map.current.on('click', 'radius-districts-fill', (e) => {
        const properties = e.features[0].properties;
        const districtData = data.districts.find(d => d.district_name === properties.district_name);
        
        let popupContent = `
          <div style="font-family: 'Segoe UI', Arial, sans-serif; min-width: 300px; max-width: 400px;">
            <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 15px; margin: -10px -10px 15px -10px; border-radius: 8px 8px 0 0;">
              <h3 style="margin: 0; font-size: 18px; font-weight: 600;">${properties.district_name}</h3>
              <p style="margin: 5px 0 0 0; opacity: 0.9; font-size: 14px;">📍 ${properties.state_name}</p>
            </div>
            
            <div style="background: #f8f9fa; padding: 12px; border-radius: 6px; margin-bottom: 15px;">
              <div style="display: flex; align-items: center; margin-bottom: 8px;">
                <span style="background: #4285f4; color: white; padding: 4px 8px; border-radius: 12px; font-size: 12px; font-weight: 500;">📏 DISTANCE</span>
                <span style="margin-left: 10px; font-weight: 600; color: #333;">${properties.distance_km.toFixed(1)} km</span>
              </div>
        `;

        if (districtData) {
          // Show overall performance if available
          if (districtData.overall_performance_2021 !== undefined) {
            const perf = districtData.overall_performance_2021;
            const perfColor = perf >= 75 ? '#28a745' : perf >= 50 ? '#ffc107' : perf >= 25 ? '#fd7e14' : '#dc3545';
            popupContent += `
              <div style="display: flex; align-items: center; margin-bottom: 8px;">
                <span style="background: ${perfColor}; color: white; padding: 4px 8px; border-radius: 12px; font-size: 12px; font-weight: 500;">📊 PERFORMANCE</span>
                <div style="margin-left: 10px; flex: 1;">
                  <div style="background: #e9ecef; height: 8px; border-radius: 4px; overflow: hidden;">
                    <div style="background: ${perfColor}; height: 100%; width: ${perf}%; transition: width 0.3s ease;"></div>
                  </div>
                  <span style="font-size: 12px; color: #666; margin-left: 4px;">${perf.toFixed(1)}th percentile</span>
                </div>
              </div>
            `;
          }

          // Show AAC if available
          let aac = districtData.avg_annual_change;
          if (aac === undefined && districtData.indicators && districtData.indicators.length > 0) {
            const aacVals = districtData.indicators.map(i => i.annual_change).filter(v => v !== undefined);
            if (aacVals.length > 0) aac = aacVals.reduce((a, b) => a + b, 0) / aacVals.length;
          }
          if (aac !== undefined) {
            const aacColor = aac > 0 ? '#28a745' : aac < 0 ? '#dc3545' : '#6c757d';
            const aacIcon = aac > 0 ? '📈' : aac < 0 ? '📉' : '➡️';
            popupContent += `
              <div style="display: flex; align-items: center;">
                <span style="background: ${aacColor}; color: white; padding: 4px 8px; border-radius: 12px; font-size: 12px; font-weight: 500;">${aacIcon} AAC</span>
                <span style="margin-left: 10px; font-weight: 600; color: ${aacColor};">${aac > 0 ? '+' : ''}${aac.toFixed(3)}</span>
                <span style="margin-left: 5px; font-size: 12px; color: #666;">per year</span>
              </div>
            `;
          }
          
          popupContent += `</div>`;

          // Show indicator values in a more structured way
          if (districtData.indicators && districtData.indicators.length > 0) {
            popupContent += `
              <div style="margin-top: 15px;">
                <h4 style="margin: 0 0 10px 0; color: #495057; font-size: 14px; font-weight: 600; border-bottom: 2px solid #e9ecef; padding-bottom: 5px;">📋 Indicators</h4>
            `;
            districtData.indicators.forEach(ind => {
              const change = ind.annual_change;
              const changeColor = change > 0 ? '#28a745' : change < 0 ? '#dc3545' : '#6c757d';
              const changeIcon = change > 0 ? '↗️' : change < 0 ? '↘️' : '→';
              
              popupContent += `
                <div style="background: #ffffff; border: 1px solid #e9ecef; border-radius: 6px; padding: 10px; margin-bottom: 8px;">
                  <div style="font-weight: 600; color: #343a40; margin-bottom: 6px; font-size: 13px;">${ind.indicator_name}</div>
                  <div style="display: flex; justify-content: space-between; align-items: center;">
                    <div style="font-size: 12px;">
                      <span style="color: #6c757d;">2016:</span> <strong>${ind.value_2016 ?? 'N/A'}</strong> →
                      <span style="color: #6c757d;">2021:</span> <strong>${ind.value_2021 ?? 'N/A'}</strong>
                    </div>
                    ${change !== undefined ? `
                      <div style="background: ${changeColor}; color: white; padding: 2px 6px; border-radius: 8px; font-size: 11px; font-weight: 500;">
                        ${changeIcon} ${change > 0 ? '+' : ''}${change.toFixed(3)}
                      </div>
                    ` : ''}
                  </div>
                </div>
              `;
            });
            popupContent += `</div>`;
          }
        } else {
          popupContent += `</div><div style="color: #6c757d; font-style: italic; text-align: center; padding: 10px;">No detailed data available</div>`;
        }

        popupContent += '</div>';

        // Calculate responsive positioning - always show in top-left area but avoid UI elements
        const canvas = map.current.getCanvas();
        const canvasRect = canvas.getBoundingClientRect();
        
        // Position popup in top-left but offset to avoid floating controls
        const topOffset = 80; // Avoid floating tab navigation
        const leftOffset = 20; // Small margin from edge
        
        // Convert canvas coordinates to LngLat for popup positioning
        const popupPoint = map.current.unproject([leftOffset, topOffset]);
        
        new mapboxgl.Popup({ 
          closeButton: true,
          closeOnClick: false,
          maxWidth: window.innerWidth < 768 ? '300px' : '400px',
          anchor: 'top-left',
          offset: [0, 0]
        })
          .setLngLat(popupPoint)
          .setHTML(popupContent)
          .addTo(map.current);
      });

      // Change cursor on hover
      map.current.on('mouseenter', 'radius-districts-fill', () => {
        map.current.getCanvas().style.cursor = 'pointer';
      });

      map.current.on('mouseleave', 'radius-districts-fill', () => {
        map.current.getCanvas().style.cursor = '';
      });

      // Add legend
      const legendEl = document.createElement('div');
      legendEl.className = 'mapboxgl-ctrl mapboxgl-ctrl-group';
      legendEl.style.cssText = `
        background: white;
        padding: 10px;
        border-radius: 4px;
        box-shadow: 0 0 10px rgba(0,0,0,0.1);
        font-family: Arial, sans-serif;
        font-size: 12px;
        line-height: 18px;
        max-width: 200px;
      `;

      let legendContent = `
        <div style="font-weight: bold; margin-bottom: 8px; color: #2c3e50;">Legend</div>
        <div style="display: flex; align-items: center; margin-bottom: 4px;">
          <div style="width: 15px; height: 15px; background: ${RADIUS_COLORS.center}; margin-right: 8px; border-radius: 50%;"></div>
          <span>Center Point</span>
        </div>
        <div style="display: flex; align-items: center; margin-bottom: 8px;">
          <div style="width: 15px; height: 3px; background: ${RADIUS_COLORS.radius_circle}; margin-right: 8px; border: 1px dashed ${RADIUS_COLORS.radius_circle};"></div>
          <span>${data.radius_km} km Radius</span>
        </div>
        <div style="font-weight: bold; margin: 8px 0 4px 0; color: #2c3e50;">States:</div>
      `;

      // Add state colors to legend
      allStates.forEach(state => {
        legendContent += `
          <div style="display: flex; align-items: center; margin-bottom: 4px;">
            <div style="width: 15px; height: 15px; background: ${stateColors[state]}; margin-right: 8px;"></div>
            <span>${state}</span>
          </div>
        `;
      });

      legendEl.innerHTML = legendContent;

      // Add legend to map
      map.current.addControl({
        onAdd: () => legendEl,
        onRemove: () => {}
      }, 'top-right');
    });

    return () => {
      if (map.current) {
        map.current.remove();
        map.current = null;
      }
    };
  }, [data]);

  if (!data || !data.boundary_data) {
    return (
      <div className="flex items-center justify-center h-96 bg-gray-100 rounded-lg">
        <p className="text-gray-500">Map data not available</p>
      </div>
    );
  }

  return (
    <div 
      ref={mapContainer} 
      className={fullScreen ? "w-full h-full" : "w-full h-96 rounded-lg border border-gray-300"}
      style={fullScreen ? { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 } : { minHeight: '400px' }}
    />
  );
};

// Distance vs AAC Chart
const DistanceAACChart = ({ data }) => {
  const chartData = useMemo(() => {
    if (!data || !data.districts) return null;

    // Prefer avg_annual_change at district level, else use indicator annual_change (mean)
    const validDistricts = data.districts.filter(d =>
      d.distance_km !== undefined &&
      (d.avg_annual_change !== undefined || (d.indicators && d.indicators.some(i => i.annual_change !== undefined)))
    );

    if (validDistricts.length === 0) return null;

    // Generate distinct colors for states
    const stateColorGenerator = generateStateColors();
    const states = [...new Set(validDistricts.map(d => d.state_name))];
    const stateColors = {};
    states.forEach((state, index) => {
      stateColors[state] = stateColorGenerator(index);
    });

    const datasets = states.map(state => {
      const stateDistricts = validDistricts.filter(d => d.state_name === state);
      return {
        label: state,
        data: stateDistricts.map(d => {
          let aac = d.avg_annual_change;
          if (aac === undefined && d.indicators && d.indicators.length > 0) {
            // Use mean of indicator annual_change if available
            const aacVals = d.indicators.map(i => i.annual_change).filter(v => v !== undefined);
            if (aacVals.length > 0) aac = aacVals.reduce((a, b) => a + b, 0) / aacVals.length;
          }
          return {
            x: d.distance_km,
            y: aac,
            district: d.district_name
          };
        }),
        backgroundColor: stateColors[state],
        borderColor: stateColors[state],
        pointRadius: 6,
        pointHoverRadius: 8
      };
    });

    return { datasets };
  }, [data]);

  if (!chartData) {
    return (
      <div className="flex items-center justify-center h-64 bg-gray-100 rounded-lg">
        <p className="text-gray-500">No AAC data available</p>
      </div>
    );
  }

  const options = {
    responsive: true,
    plugins: {
      legend: {
        position: 'top',
        labels: {
          usePointStyle: true,
          pointStyle: 'circle'
        }
      },
      title: {
        display: true,
        text: 'Distance vs Annual Average Change (AAC)',
        font: { size: 16, weight: 'bold' }
      },
      tooltip: {
        callbacks: {
          label: (context) => {
            const point = context.parsed;
            const district = context.raw.district;
            return `${district}: ${point.x} km, AAC: ${point.y?.toFixed(3)}`;
          }
        }
      }
    },
    scales: {
      x: {
        type: 'linear',
        position: 'bottom',
        title: {
          display: true,
          text: 'Distance from Center (km)',
          font: { size: 14, weight: 'bold' }
        }
      },
      y: {
        title: {
          display: true,
          text: 'Annual Average Change (AAC)',
          font: { size: 14, weight: 'bold' }
        }
      }
    }
  };

  return (
    <div className="bg-white p-4 rounded-lg shadow">
      <Scatter data={chartData} options={options} />
    </div>
  );
};

// AAC Comparison Chart (2016 vs 2021 AAC)
const AACComparisonChart = ({ data }) => {
  const chartData = useMemo(() => {
    if (!data || !data.districts) return null;

    // Use avg_annual_change if available, else mean of indicator annual_change
    const validDistricts = data.districts.filter(d =>
      d.avg_annual_change !== undefined || (d.indicators && d.indicators.some(i => i.annual_change !== undefined))
    ).slice(0, 10); // Top 10 districts

    if (validDistricts.length === 0) return null;

    // Sort by distance for better visualization
    validDistricts.sort((a, b) => a.distance_km - b.distance_km);

    return {
      labels: validDistricts.map(d => `${d.district_name.substring(0, 15)}${d.district_name.length > 15 ? '...' : ''}`),
      datasets: [
        {
          label: 'AAC (2016-2021)',
          data: validDistricts.map(d => {
            let aac = d.avg_annual_change;
            if (aac === undefined && d.indicators && d.indicators.length > 0) {
              const aacVals = d.indicators.map(i => i.annual_change).filter(v => v !== undefined);
              if (aacVals.length > 0) aac = aacVals.reduce((a, b) => a + b, 0) / aacVals.length;
            }
            return aac;
          }),
          backgroundColor: RADIUS_COLORS.district_good,
          borderColor: RADIUS_COLORS.district_good,
          borderWidth: 1
        }
      ]
    };
  }, [data]);

  if (!chartData) {
    return (
      <div className="flex items-center justify-center h-64 bg-gray-100 rounded-lg">
        <p className="text-gray-500">No AAC data available</p>
      </div>
    );
  }

  const options = {
    responsive: true,
    plugins: {
      legend: {
        position: 'top'
      },
      title: {
        display: true,
        text: 'Annual Average Change (AAC) by District',
        font: { size: 16, weight: 'bold' }
      },
      tooltip: {
        callbacks: {
          label: (context) => {
            const district = data.districts.find(d =>
              d.district_name.startsWith(context.label.replace('...', ''))
            );
            let aac = district?.avg_annual_change;
            if (aac === undefined && district?.indicators && district.indicators.length > 0) {
              const aacVals = district.indicators.map(i => i.annual_change).filter(v => v !== undefined);
              if (aacVals.length > 0) aac = aacVals.reduce((a, b) => a + b, 0) / aacVals.length;
            }
            return `${context.dataset.label}: ${aac !== undefined ? aac.toFixed(3) : 'N/A'}`;
          }
        }
      }
    },
    scales: {
      y: {
        title: {
          display: true,
          text: 'Annual Average Change (AAC)',
          font: { size: 14, weight: 'bold' }
        }
      },
      x: {
        title: {
          display: true,
          text: 'Districts (sorted by distance)',
          font: { size: 14, weight: 'bold' }
        }
      }
    }
  };

  return (
    <div className="bg-white p-4 rounded-lg shadow">
      <Bar data={chartData} options={options} />
    </div>
  );
};

// Improvement Trends Chart
const ImprovementTrendsChart = ({ data }) => {
  const chartData = useMemo(() => {
    if (!data || !data.districts) return null;

    const districtsWithImprovement = data.districts.filter(d => 
      d.overall_improvement !== undefined
    );

    if (districtsWithImprovement.length === 0) return null;

    // Sort by improvement (best to worst)
    const sortedDistricts = [...districtsWithImprovement]
      .sort((a, b) => b.overall_improvement - a.overall_improvement)
      .slice(0, 15); // Top 15

    return {
      labels: sortedDistricts.map(d => `${d.district_name.substring(0, 12)}${d.district_name.length > 12 ? '...' : ''}`),
      datasets: [{
        label: 'Performance Change (2016-2021)',
        data: sortedDistricts.map(d => d.overall_improvement),
        backgroundColor: sortedDistricts.map(d => 
          d.overall_improvement > 0 ? RADIUS_COLORS.improvement : RADIUS_COLORS.decline
        ),
        borderColor: sortedDistricts.map(d => 
          d.overall_improvement > 0 ? RADIUS_COLORS.improvement : RADIUS_COLORS.decline
        ),
        borderWidth: 1
      }]
    };
  }, [data]);

  if (!chartData) {
    return (
      <div className="flex items-center justify-center h-64 bg-gray-100 rounded-lg">
        <p className="text-gray-500">No improvement data available</p>
      </div>
    );
  }

  const options = {
    responsive: true,
    plugins: {
      legend: {
        display: false
      },
      title: {
        display: true,
        text: 'Performance Improvement Trends',
        font: { size: 16, weight: 'bold' }
      },
      tooltip: {
        callbacks: {
          label: (context) => {
            const district = data.districts.find(d => 
              d.district_name.startsWith(context.label.replace('...', ''))
            );
            const change = context.formattedValue;
            return `${district?.district_name}: ${change > 0 ? '+' : ''}${change} percentile points (${district?.distance_km?.toFixed(1)} km)`;
          }
        }
      }
    },
    scales: {
      y: {
        title: {
          display: true,
          text: 'Percentile Point Change',
          font: { size: 14, weight: 'bold' }
        },
        grid: {
          color: (context) => context.tick.value === 0 ? '#000' : '#e0e0e0'
        }
      },
      x: {
        title: {
          display: true,
          text: 'Districts (sorted by improvement)',
          font: { size: 14, weight: 'bold' }
        }
      }
    }
  };

  return (
    <div className="bg-white p-4 rounded-lg shadow">
      <Bar data={chartData} options={options} />
    </div>
  );
};

// Main RadiusAnalysis Component
const RadiusAnalysis = ({ radiusData, mapOnly = false, chartOnly = false }) => {
  const [activeTab, setActiveTab] = useState('overview');

  console.log('RadiusAnalysis component received data:', radiusData);
  console.log('RadiusAnalysis component props:', { mapOnly, chartOnly });

  if (!radiusData || !radiusData.districts) {
    console.log('RadiusAnalysis: No data or districts available');
    console.log('RadiusAnalysis: radiusData:', radiusData);
    console.log('RadiusAnalysis: districts:', radiusData?.districts);
    return (
      <div className="flex items-center justify-center h-64 bg-gray-100 rounded-lg">
        <div className="text-center">
          <p className="text-gray-500 text-lg">No radius analysis data available</p>
          <p className="text-gray-400 text-sm mt-2">Please try a different search query</p>
        </div>
      </div>
    );
  }

  if (mapOnly) {
    return (
      <div className="w-full h-full">
        <RadiusAnalysisMap data={radiusData} fullScreen={true} />
      </div>
    );
  }

  if (chartOnly) {
    return (
      <div className="space-y-6">
        <DistanceAACChart data={radiusData} />
        <AACComparisonChart data={radiusData} />
        <ImprovementTrendsChart data={radiusData} />
      </div>
    );
  }

  const generateSummaryStats = () => {
    const { districts, radius_km, center_point, center_type } = radiusData;
    
    const totalDistricts = districts.length;
    const statesCount = new Set(districts.map(d => d.state_name)).size;
    
    const avgDistance = districts.reduce((sum, d) => sum + (d.distance_km || 0), 0) / totalDistricts;
    
    const districtsWithPerf2021 = districts.filter(d => d.overall_performance_2021 !== undefined);
    const avgPerf2021 = districtsWithPerf2021.length > 0 
      ? districtsWithPerf2021.reduce((sum, d) => sum + d.overall_performance_2021, 0) / districtsWithPerf2021.length 
      : 0;
    
    const districtsWithImprovement = districts.filter(d => d.overall_improvement !== undefined);
    const avgImprovement = districtsWithImprovement.length > 0
      ? districtsWithImprovement.reduce((sum, d) => sum + d.overall_improvement, 0) / districtsWithImprovement.length
      : 0;

    return {
      totalDistricts,
      statesCount,
      avgDistance: avgDistance.toFixed(1),
      avgPerf2021: avgPerf2021.toFixed(1),
      avgImprovement: avgImprovement.toFixed(1),
      radius_km,
      center_point,
      center_type
    };
  };

  const stats = generateSummaryStats();

  // If overview tab is active, render just the map with minimal UI
  if (activeTab === 'overview') {
    return (
      <div className="relative w-full h-screen overflow-hidden">
        {/* Floating tab navigation for overview */}
        <div className="absolute top-4 left-4 z-10 bg-white rounded-lg shadow-lg">
          <nav className="flex">
            {[
              { id: 'overview', label: 'Map Overview' },
              { id: 'performance', label: 'Performance Analysis' },
              { id: 'trends', label: 'Improvement Trends' }
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`py-2 px-4 font-medium text-sm first:rounded-l-lg last:rounded-r-lg ${
                  activeTab === tab.id
                    ? 'bg-blue-500 text-white'
                    : 'bg-white text-gray-700 hover:bg-gray-50'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </nav>
        </div>
        
        {/* Floating stats summary */}
        <div className="absolute top-4 right-4 z-10 bg-white rounded-lg shadow-lg p-4 max-w-sm">
          <h3 className="text-lg font-bold text-gray-800 mb-2">
            {stats.radius_km} km Radius
          </h3>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="text-center">
              <div className="text-lg font-bold text-blue-600">{stats.totalDistricts}</div>
              <div className="text-gray-600">Districts</div>
            </div>
            <div className="text-center">
              <div className="text-lg font-bold text-green-600">{stats.statesCount}</div>
              <div className="text-gray-600">States</div>
            </div>
          </div>
          <p className="text-xs text-gray-600 mt-2">
            <strong>Center:</strong> {stats.center_point}
          </p>
        </div>
        
        <RadiusAnalysisMap data={radiusData} fullScreen={true} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Summary Header */}
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-2xl font-bold text-gray-800 mb-4">
          Districts Within {stats.radius_km} km Radius Analysis
        </h2>
        <p className="text-gray-600 mb-4">
          <strong>Center:</strong> {stats.center_point} ({stats.center_type})
        </p>
        
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
          <div className="bg-blue-50 p-4 rounded-lg text-center">
            <div className="text-2xl font-bold text-blue-600">{stats.totalDistricts}</div>
            <div className="text-sm text-gray-600">Total Districts</div>
          </div>
          <div className="bg-green-50 p-4 rounded-lg text-center">
            <div className="text-2xl font-bold text-green-600">{stats.statesCount}</div>
            <div className="text-sm text-gray-600">States Covered</div>
          </div>
          <div className="bg-purple-50 p-4 rounded-lg text-center">
            <div className="text-2xl font-bold text-purple-600">{stats.avgDistance}</div>
            <div className="text-sm text-gray-600">Avg Distance (km)</div>
          </div>
          <div className="bg-orange-50 p-4 rounded-lg text-center">
            <div className="text-2xl font-bold text-orange-600">{stats.avgPerf2021}</div>
            <div className="text-sm text-gray-600">Avg Performance</div>
          </div>
          <div className="bg-red-50 p-4 rounded-lg text-center">
            <div className="text-2xl font-bold text-red-600">
              {stats.avgImprovement > 0 ? '+' : ''}{stats.avgImprovement}
            </div>
            <div className="text-sm text-gray-600">Avg Improvement</div>
          </div>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="bg-white rounded-lg shadow">
        <div className="border-b border-gray-200">
          <nav className="-mb-px flex space-x-8 px-6">
            {[
              { id: 'overview', label: 'Map Overview' },
              { id: 'performance', label: 'Performance Analysis' },
              { id: 'trends', label: 'Improvement Trends' }
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`py-4 px-1 border-b-2 font-medium text-sm ${
                  activeTab === tab.id
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </nav>
        </div>

        <div className="p-6">
          {activeTab === 'performance' && (
            <div className="space-y-6">
              <AACComparisonChart data={radiusData} />
              <DistanceAACChart data={radiusData} />
            </div>
          )}

          {activeTab === 'trends' && (
            <div className="space-y-6">
              <ImprovementTrendsChart data={radiusData} />
              <div className="bg-white p-4 rounded-lg border border-gray-200">
                <h3 className="text-lg font-semibold text-gray-800 mb-3">Key Insights</h3>
                <div className="space-y-2 text-sm text-gray-600">
                  {radiusData.analysis && (
                    <div className="prose prose-sm max-w-none">
                      <div dangerouslySetInnerHTML={{ 
                        __html: radiusData.analysis.replace(/\n/g, '<br/>').replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>') 
                      }} />
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default RadiusAnalysis; 