import React, { useState, useMemo } from 'react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend,
} from 'chart.js';
import { Bar } from 'react-chartjs-2';
import Map, { Source, Layer } from 'react-map-gl';
import 'mapbox-gl/dist/mapbox-gl.css';

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend
);

const MAPBOX_TOKEN = "pk.eyJ1Ijoic2FuZGVzaDMzOSIsImEiOiJjbThqazJuaTYwaTlwMmtwdzU4NzUwN3YwIn0.Kc6gPcC0Jf2rSJN4ieeimA";

// Enhanced state colors for state-wise visualization
const STATE_COLORS = [
  "#E74C3C", "#3498DB", "#2ECC71", "#F39C12", "#9B59B6", 
  "#1ABC9C", "#E67E22", "#34495E", "#E91E63", "#00BCD4",
  "#F1C40F", "#8E44AD", "#E67E22", "#2C3E50", "#D35400"
];

const StateWiseAnalysis = ({ data, boundary = [], onStateSelect, onBack, chartOnly = false, isModal = false }) => {
  const [sortBy, setSortBy] = useState('average_performance');
  // Initialize viewMode properly - if chartOnly is true, always start with overview
  const [viewMode, setViewMode] = useState(chartOnly ? 'overview' : (isModal ? 'map' : 'overview'));
  const [viewState, setViewState] = useState({
    longitude: 78.96,
    latitude: 20.59,
    zoom: 4.5
  });
  const [selectedState, setSelectedState] = useState(null);

  // Extract actual data from the backend response structure
  const actualData = useMemo(() => {
    if (data?.data && Array.isArray(data.data) && data.data.length > 0) {
      return data.data[0].result;
    } else if (data?.analysis_type === "state_wise_summary") {
      return data;
    }
    return null;
  }, [data]);
  
  // Extract state data and summary from the actual data
  const stateData = actualData?.data || [];
  const summary = actualData?.summary || {};

  // Extract boundaries - support both boundary parameter and data.boundary_data
  const boundaries = useMemo(() => {
    if (!data && !actualData) return [];
    const processBoundaries = Array.isArray(boundary) && boundary.length
      ? boundary
      : (Array.isArray(actualData?.boundary_data) ? actualData.boundary_data : 
         Array.isArray(actualData?.boundary) ? actualData.boundary :
         Array.isArray(data?.boundary_data) ? data.boundary_data : 
         Array.isArray(data?.boundary) ? data.boundary : []);
      
    return processBoundaries;
  }, [boundary, actualData?.boundary_data, actualData?.boundary, data?.boundary_data, data?.boundary]);

  // State color mapping and normalized features for map visualization
  const { normalizedFeatures, stateColorMapping } = useMemo(() => {
    let features = [];
    let stateColors = {};
    
    if (!stateData || stateData.length === 0 || boundaries.length === 0) {
      return { normalizedFeatures: features, stateColorMapping: stateColors };
    }

    const sortedStates = [...stateData].sort((a, b) => 
      (b.avg_performance_percentile || 0) - (a.avg_performance_percentile || 0)
    );
    
    sortedStates.forEach((state, index) => {
      const stateName = state.state || state.state_name;
      stateColors[stateName] = STATE_COLORS[index % STATE_COLORS.length];
    });

    boundaries.forEach((boundaryEntry) => {
      const districtName = boundaryEntry.district || boundaryEntry.district_name;
      const stateName = boundaryEntry.state || boundaryEntry.state_name;
      
      const stateInfo = stateData.find(s => 
        (s.state || s.state_name) === stateName
      );

      if (stateInfo && boundaryEntry.geometry) {
        const stateColor = stateColors[stateName] || STATE_COLORS[0];
        
        const performance = stateInfo.avg_performance_percentile || 0;
        let fillOpacity = 0.3;
        if (performance >= 80) fillOpacity = 0.8;
        else if (performance >= 60) fillOpacity = 0.6;
        else if (performance >= 40) fillOpacity = 0.4;
        
        const hex = stateColor.replace('#', '');
        const r = parseInt(hex.substr(0, 2), 16);
        const g = parseInt(hex.substr(2, 2), 16);
        const b = parseInt(hex.substr(4, 2), 16);
        const fillColor = `rgba(${r}, ${g}, ${b}, ${fillOpacity})`;

        features.push({
          type: "Feature",
          geometry: boundaryEntry.geometry,
          properties: {
            district_name: districtName,
            state_name: stateName,
            avg_performance_percentile: stateInfo.avg_performance_percentile || 0,
            total_districts: stateInfo.total_districts || 0,
            aspirational_districts: stateInfo.aspirational_districts || 0,
            improvement_rate: stateInfo.overall_improvement_rate || stateInfo.avg_improvement_rate || 0,
            color: fillColor,
            base_color: stateColor,
            best_indicator: stateInfo.best_indicator,
            worst_indicator: stateInfo.worst_indicator
          }
        });
      }
    });

    return { normalizedFeatures: features, stateColorMapping: stateColors };
  }, [stateData, boundaries]);

  // Early return after all hooks are called
  if (!actualData || !actualData.data || actualData.data.length === 0) {
    return (
      <div className="bg-white rounded-lg shadow-md p-6">
        <h2 className="text-2xl font-bold text-gray-800 mb-4">State-wise Analysis</h2>
        <p className="text-gray-600">No state-wise data available.</p>
        {onBack && (
          <button
            onClick={onBack}
            className="mt-4 px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
          >
            ← Back
          </button>
        )}
      </div>
    );
  }

  // Handle district click on map
  const handleDistrictClick = (event) => {
    if (event.features && event.features.length > 0) {
      const feature = event.features[0];
      const properties = feature.properties;
      
      setSelectedState({
        district: properties.district_name,
        state: properties.state_name,
        performance: properties.avg_performance_percentile,
        districts: properties.total_districts,
        aspirational: properties.aspirational_districts,
        improvement: properties.improvement_rate,
        bestIndicator: properties.best_indicator,
        worstIndicator: properties.worst_indicator
      });
    }
  };

  // Sort states based on selected criteria
  const sortedStates = [...stateData].sort((a, b) => {
    switch (sortBy) {
      case 'average_performance':
        return (b.avg_performance_percentile || 0) - (a.avg_performance_percentile || 0);
      case 'improvement_rate':
        return (b.overall_improvement_rate || b.avg_improvement_rate || 0) - (a.overall_improvement_rate || a.avg_improvement_rate || 0);
      case 'district_count':
        return (b.total_districts || 0) - (a.total_districts || 0);
      case 'aspirational_districts':
        return (b.aspirational_districts || b.aspirational_districts_count || 0) - (a.aspirational_districts || a.aspirational_districts_count || 0);
      default:
        return 0;
    }
  });

  // Prepare chart data
  const topStates = sortedStates.slice(0, 10);
  
  const performanceChartData = {
    labels: topStates.map(state => state.state || state.state_name),
    datasets: [
      {
        label: 'Performance Percentile',
        data: topStates.map(state => state.avg_performance_percentile || 0),
        backgroundColor: 'rgba(59, 130, 246, 0.5)',
        borderColor: 'rgba(59, 130, 246, 1)',
        borderWidth: 1,
      },
    ],
  };

  // Debug aspirational districts data
  console.log('Aspirational districts data:', topStates.map(state => ({
    state: state.state || state.state_name,
    aspirational: state.aspirational_districts || state.aspirational_districts_count || 0,
    total: state.total_districts || 0
  })));

  const districtCountChartData = {
    labels: topStates.map(state => state.state || state.state_name),
    datasets: [
      {
        label: 'Regular Districts',
        data: topStates.map(state => {
          const total = state.total_districts || 0;
          const aspirational = state.aspirational_districts || state.aspirational_districts_count || 0;
          return total - aspirational;
        }),
        backgroundColor: 'rgba(16, 185, 129, 0.7)',
        borderColor: 'rgba(16, 185, 129, 1)',
        borderWidth: 1,
      },
      {
        label: 'Aspirational Districts',
        data: topStates.map(state => state.aspirational_districts || state.aspirational_districts_count || 0),
        backgroundColor: 'rgba(239, 68, 68, 0.7)',
        borderColor: 'rgba(239, 68, 68, 1)',
        borderWidth: 1,
      },
    ],
  };

  const improvementChartData = {
    labels: topStates.map(state => state.state || state.state_name),
    datasets: [
      {
        label: 'Improvement Rate (%)',
        data: topStates.map(state => ((state.overall_improvement_rate || state.avg_improvement_rate || 0) * 100)),
        backgroundColor: 'rgba(147, 51, 234, 0.5)',
        borderColor: 'rgba(147, 51, 234, 1)',
        borderWidth: 1,
      },
    ],
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
        text: 'State-wise Analysis',
      },
    },
    scales: {
      y: {
        beginAtZero: true,
      },
    },
  };

  const stackedChartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: 'top',
      },
      title: {
        display: true,
        text: 'Districts by State',
      },
    },
    scales: {
      x: {
        stacked: true,
      },
      y: {
        stacked: true,
        beginAtZero: true,
      },
    },
  };

  const getPerformanceColor = (percentile) => {
    if (percentile >= 80) return 'text-green-600';
    if (percentile >= 60) return 'text-yellow-600';
    return 'text-red-600';
  };

  const getImprovementIcon = (rate) => {
    if (rate > 0.05) return '📈';
    if (rate > 0) return '↗️';
    if (rate === 0) return '➡️';
    return '📉';
  };

  return (
    <div className="bg-white rounded-lg shadow-md p-6">
      {/* Back button for non-overview modes */}
      {onBack && viewMode !== 'overview' && (
        <div className="flex justify-end mb-4">
          <button
            onClick={onBack}
            className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
          >
            ← Back
          </button>
        </div>
      )}

      {/* Controls - Only show for non-map views */}
      {viewMode !== 'map' && (
        <div style={{ 
          background: 'linear-gradient(135deg, #f8fafc, #e2e8f0)', 
          padding: '24px', 
          borderRadius: '16px', 
          boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.1)',
          border: '2px solid #e2e8f0',
          marginBottom: '24px'
        }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '24px', alignItems: 'end' }}>
            <div>
              <label style={{ 
                display: 'block', 
                fontSize: '14px', 
                fontWeight: '600', 
                color: '#374151', 
                marginBottom: '8px',
                textTransform: 'uppercase',
                letterSpacing: '0.05em'
              }}>
                📊 Sort by:
              </label>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                style={{
                  width: '100%',
                  padding: '12px 16px',
                  border: '2px solid #d1d5db',
                  borderRadius: '12px',
                  fontSize: '14px',
                  fontWeight: '500',
                  color: '#374151',
                  background: 'linear-gradient(135deg, #ffffff, #f9fafb)',
                  boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
                  outline: 'none',
                  transition: 'all 0.3s ease',
                  cursor: 'pointer'
                }}
                onFocus={(e) => {
                  e.target.style.borderColor = '#3b82f6';
                  e.target.style.boxShadow = '0 0 0 3px rgba(59, 130, 246, 0.1)';
                }}
                onBlur={(e) => {
                  e.target.style.borderColor = '#d1d5db';
                  e.target.style.boxShadow = '0 4px 6px -1px rgba(0, 0, 0, 0.1)';
                }}
              >
                <option value="average_performance">🏆 Performance</option>
                <option value="improvement_rate">📈 Improvement Rate</option>
                <option value="district_count">🏘️ District Count</option>
                <option value="aspirational_districts">🎯 Aspirational Districts</option>
              </select>
            </div>

            <div>
              <label style={{ 
                display: 'block', 
                fontSize: '14px', 
                fontWeight: '600', 
                color: '#374151', 
                marginBottom: '8px',
                textTransform: 'uppercase',
                letterSpacing: '0.05em'
              }}>
                👁️ View Mode:
              </label>
              <select
                value={viewMode}
                onChange={(e) => {
                  setViewMode(e.target.value);
                }}
                style={{
                  width: '100%',
                  padding: '12px 16px',
                  border: '2px solid #d1d5db',
                  borderRadius: '12px',
                  fontSize: '14px',
                  fontWeight: '500',
                  color: '#374151',
                  background: 'linear-gradient(135deg, #ffffff, #f9fafb)',
                  boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
                  outline: 'none',
                  transition: 'all 0.3s ease',
                  cursor: 'pointer'
                }}
                onFocus={(e) => {
                  e.target.style.borderColor = '#10b981';
                  e.target.style.boxShadow = '0 0 0 3px rgba(16, 185, 129, 0.1)';
                }}
                onBlur={(e) => {
                  e.target.style.borderColor = '#d1d5db';
                  e.target.style.boxShadow = '0 4px 6px -1px rgba(0, 0, 0, 0.1)';
                }}
              >
                <option value="overview">📋 Overview</option>
                <option value="detailed">📊 Detailed Table</option>
                <option value="comparison">⚖️ Comparison View</option>
                <option value="map">🗺️ Geographic Map</option>
              </select>
            </div>
          </div>
        </div>
      )}

      {/* Summary Stats - Only show for detailed and comparison views */}
      {(viewMode === 'detailed' || viewMode === 'comparison') && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-blue-50 p-4 rounded-lg">
            <h3 className="text-lg font-semibold text-blue-800">States Analyzed</h3>
            <p className="text-2xl font-bold text-blue-600">{stateData.length}</p>
          </div>
          <div className="bg-green-50 p-4 rounded-lg">
            <h3 className="text-lg font-semibold text-green-800">Avg Performance</h3>
            <p className="text-2xl font-bold text-green-600">
              {summary.avg_performance_range ? 
                `${Math.round(summary.avg_performance_range.highest)}%` : 'N/A'}
            </p>
          </div>
          <div className="bg-yellow-50 p-4 rounded-lg">
            <h3 className="text-lg font-semibold text-yellow-800">Total Districts</h3>
            <p className="text-2xl font-bold text-yellow-600">
              {summary.total_districts_analyzed || 0}
            </p>
          </div>
          <div className="bg-red-50 p-4 rounded-lg">
            <h3 className="text-lg font-semibold text-red-800">Aspirational Districts</h3>
            <p className="text-2xl font-bold text-red-600">
              {summary.total_aspirational_districts || 0}
            </p>
          </div>
        </div>
      )}

      {/* Main Content based on View Mode */}
      {viewMode === 'overview' && (
        <div className="space-y-6">
          {/* Main Title */}
          <div className="text-center">
            <h2 className="text-2xl font-bold text-gray-800 mb-2">State-wise SDG Analysis</h2>
            <p className="text-gray-600">Performance analysis across {stateData.length} states and {summary.total_districts_analyzed || 0} districts</p>
          </div>
          
          {/* Charts Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
            <div style={{ height: '280px' }}>
              
              <Bar data={performanceChartData} options={chartOptions} />
            </div>
            <div style={{ height: '400px' }}>
              
              <Bar data={districtCountChartData} options={stackedChartOptions} />
            </div>
            <div style={{ height: '400px' }}>
              
              <Bar data={improvementChartData} options={chartOptions} />
            </div>
          </div>
        </div>
      )}

      {viewMode === 'detailed' && (
        <div className="overflow-x-auto">
          <table className="min-w-full bg-white border border-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">State</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Performance</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Districts</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Improvement</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Aspirational</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {sortedStates.map((state, index) => (
                <tr key={index} className="hover:bg-gray-50">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm font-medium text-gray-900">
                      {state.state || state.state_name}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className={`text-sm font-medium ${getPerformanceColor(state.avg_performance_percentile || 0)}`}>
                      {(state.avg_performance_percentile || 0).toFixed(1)}%
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    {state.total_districts || 0}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    <span className="flex items-center">
                      {getImprovementIcon(state.overall_improvement_rate || state.avg_improvement_rate || 0)}
                      <span className="ml-1">
                        {((state.overall_improvement_rate || state.avg_improvement_rate || 0) * 100).toFixed(2)}%
                      </span>
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    {state.aspirational_districts || state.aspirational_districts_count || 0}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {viewMode === 'comparison' && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {sortedStates.slice(0, 6).map((state, index) => (
            <div key={index} className="bg-gray-50 p-4 rounded-lg border">
              <h4 className="font-semibold text-gray-800 mb-2">{state.state || state.state_name}</h4>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span>Performance:</span>
                  <span className={`font-medium ${getPerformanceColor(state.avg_performance_percentile || 0)}`}>
                    {(state.avg_performance_percentile || 0).toFixed(1)}%
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Districts:</span>
                  <span>{state.total_districts || 0}</span>
                </div>
                <div className="flex justify-between">
                  <span>Improvement:</span>
                  <span>{((state.overall_improvement_rate || state.avg_improvement_rate || 0) * 100).toFixed(2)}%</span>
                </div>
                <div className="flex justify-between">
                  <span>Aspirational:</span>
                  <span>{state.aspirational_districts || state.aspirational_districts_count || 0}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

            {/* Enhanced Map View */}
      {viewMode === 'map' && (
        <div className="space-y-4">
           {/* COMPACT CARD-STYLE SUMMARY BAR */}
           <div style={{
             background: 'linear-gradient(to right, #f8fafc, #eff6ff)',
             border: '2px solid #2563eb',
             borderRadius: '16px',
             boxShadow: '0 15px 30px -10px rgba(0, 0, 0, 0.2)',
             padding: '20px',
             marginBottom: '16px'
           }}>
             <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
               <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
                 <div style={{
                   background: 'linear-gradient(135deg, #dbeafe, #bfdbfe)',
                   borderRadius: '12px',
                   padding: '16px',
                   textAlign: 'center',
                   minWidth: '90px',
                   boxShadow: '0 6px 10px -2px rgba(0, 0, 0, 0.1)',
                   border: '2px solid #3b82f6'
                 }}>
                   <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#1e40af', marginBottom: '4px' }}>
                     {stateData.length}
                   </div>
                   <div style={{ fontSize: '11px', color: '#1d4ed8', fontWeight: '600', textTransform: 'uppercase' }}>
                     STATES
                   </div>
                 </div>
                 
                 <div style={{
                   background: 'linear-gradient(135deg, #dcfce7, #bbf7d0)',
                   borderRadius: '12px',
                   padding: '16px',
                   textAlign: 'center',
                   minWidth: '90px',
                   boxShadow: '0 6px 10px -2px rgba(0, 0, 0, 0.1)',
                   border: '2px solid #10b981'
                 }}>
                   <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#047857', marginBottom: '4px' }}>
                     {summary.avg_performance_range ? `${Math.round(summary.avg_performance_range.highest)}%` : 'N/A'}
                   </div>
                   <div style={{ fontSize: '11px', color: '#059669', fontWeight: '600', textTransform: 'uppercase' }}>
                     AVG PERFORMANCE
                   </div>
                 </div>
                 
                 <div style={{
                   background: 'linear-gradient(135deg, #fed7aa, #fdba74)',
                   borderRadius: '12px',
                   padding: '16px',
                   textAlign: 'center',
                   minWidth: '90px',
                   boxShadow: '0 6px 10px -2px rgba(0, 0, 0, 0.1)',
                   border: '2px solid #f97316'
                 }}>
                   <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#c2410c', marginBottom: '4px' }}>
                     {summary.total_districts_analyzed || 0}
                   </div>
                   <div style={{ fontSize: '11px', color: '#ea580c', fontWeight: '600', textTransform: 'uppercase' }}>
                     DISTRICTS
                   </div>
                 </div>
                 
                 <div style={{
                   background: 'linear-gradient(135deg, #fecaca, #fca5a5)',
                   borderRadius: '12px',
                   padding: '16px',
                   textAlign: 'center',
                   minWidth: '90px',
                   boxShadow: '0 6px 10px -2px rgba(0, 0, 0, 0.1)',
                   border: '2px solid #ef4444'
                 }}>
                   <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#b91c1c', marginBottom: '4px' }}>
                     {summary.total_aspirational_districts || 0}
                   </div>
                   <div style={{ fontSize: '11px', color: '#dc2626', fontWeight: '600', textTransform: 'uppercase' }}>
                     ASPIRATIONAL
                   </div>
                 </div>
               </div>
               
               <div style={{
                 background: 'linear-gradient(135deg, #4f46e5, #7c3aed)',
                 color: 'white',
                 padding: '12px 18px',
                 borderRadius: '12px',
                 boxShadow: '0 6px 10px -2px rgba(0, 0, 0, 0.1)',
                 display: 'flex',
                 alignItems: 'center',
                 gap: '8px',
                 fontWeight: '600',
                 border: '2px solid #6366f1'
               }}>
                 <span style={{ fontSize: '18px' }}>🗺️</span>
                 <span style={{ fontSize: '13px' }}>Click districts for details</span>
               </div>
             </div>
           </div>

           {/* Map Container */}
           <div className="border border-gray-300 rounded-lg overflow-hidden shadow-lg" style={{ height: '600px' }}>
            <Map
              {...viewState}
              onMove={evt => setViewState(evt.viewState)}
              style={{ width: '100%', height: '100%' }}
              mapStyle="mapbox://styles/mapbox/light-v10"
              mapboxAccessToken={MAPBOX_TOKEN}
              interactiveLayerIds={['state-fill']}
              onClick={handleDistrictClick}
            >
              {normalizedFeatures.length > 0 && (
                <Source
                  id="states"
                  type="geojson"
                  data={{
                    type: "FeatureCollection",
                    features: normalizedFeatures
                  }}
                >
                  <Layer
                    id="state-fill"
                    type="fill"
                    paint={{
                      'fill-color': ['get', 'color'],
                      'fill-opacity': 0.8
                    }}
                  />
                  <Layer
                    id="state-border"
                    type="line"
                    paint={{
                      'line-color': '#1f2937',
                      'line-width': 0.5,
                      'line-opacity': 0.5
                    }}
                  />
                </Source>
              )}

                             {/* Enhanced State Legend */}
               {stateData.length > 0 && (
                 <div style={{
                   position: 'absolute',
                   bottom: '15px',
                   left: '50%',
                   transform: 'translateX(-50%)',
                   background: 'rgba(255, 255, 255, 0.96)',
                   borderRadius: '10px',
                   padding: '12px 16px',
                   boxShadow: '0 6px 24px rgba(0,0,0,0.15)',
                   border: '1px solid rgba(0,0,0,0.1)',
                   backdropFilter: 'blur(10px)',
                   maxWidth: '90vw'
                 }}>
                   <div style={{ 
                     fontSize: '11px', 
                     fontWeight: 'bold', 
                     color: '#374151', 
                     marginBottom: '6px',
                     textAlign: 'center'
                   }}>
                     State Performance Rankings
                   </div>
                   <div style={{ 
                     display: 'grid',
                     gridTemplateColumns: 'repeat(5, 1fr)',
                     gap: '4px',
                     alignItems: 'center'
                   }}>
                                         {Object.entries(stateColorMapping).map(([stateName, color], index) => {
                       const stateInfo = stateData.find(s => (s.state || s.state_name) === stateName);
                       const performance = stateInfo?.avg_performance_percentile || 0;
                       return (
                         <div key={stateName} style={{ 
                           display: 'flex', 
                           alignItems: 'center', 
                           gap: '6px',
                           background: 'rgba(249, 250, 251, 0.9)',
                           padding: '4px 8px',
                           borderRadius: '16px',
                           border: '1px solid rgba(0,0,0,0.08)',
                           margin: '2px'
                         }}>
                           <div style={{
                             width: '12px',
                             height: '12px',
                             backgroundColor: color,
                             borderRadius: '50%',
                             border: '1px solid rgba(255,255,255,0.9)',
                             boxShadow: '0 1px 3px rgba(0,0,0,0.15)'
                           }} />
                           <span style={{ 
                             fontSize: '10px',
                             fontWeight: '600',
                             color: '#1f2937'
                           }}>
                             #{index + 1} {stateName}
                           </span>
                           <span style={{ 
                             fontSize: '9px',
                             color: '#6b7280',
                             fontWeight: '500'
                           }}>
                             ({Math.round(performance)}%)
                           </span>
                         </div>
                       );
                     })}
                  </div>
                </div>
              )}

              {/* Enhanced Selected State Info Panel */}
              {selectedState && (
                <div style={{
                  position: 'absolute',
                  top: '20px',
                  left: '20px',
                  background: 'rgba(255, 255, 255, 0.98)',
                  padding: '16px',
                  borderRadius: '12px',
                  boxShadow: '0 8px 32px rgba(0,0,0,0.12)',
                  border: '1px solid rgba(0,0,0,0.08)',
                  minWidth: '280px',
                  maxWidth: '350px'
                }}>
                  <div style={{ 
                    display: 'flex', 
                    justifyContent: 'space-between', 
                    alignItems: 'center',
                    marginBottom: '12px',
                    paddingBottom: '8px',
                    borderBottom: '1px solid #e5e7eb'
                  }}>
                    <div>
                      <h4 style={{ margin: 0, color: '#1f2937', fontSize: '16px', fontWeight: 'bold' }}>
                        {selectedState.district}
                      </h4>
                      <p style={{ margin: '2px 0 0 0', color: '#6b7280', fontSize: '13px' }}>
                        {selectedState.state} State
                      </p>
                    </div>
                    <button
                      onClick={() => setSelectedState(null)}
                      style={{
                        background: '#f3f4f6',
                        border: 'none',
                        borderRadius: '6px',
                        width: '28px',
                        height: '28px',
                        fontSize: '16px',
                        cursor: 'pointer',
                        color: '#6b7280',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        transition: 'all 0.2s'
                      }}
                      onMouseOver={(e) => e.target.style.background = '#e5e7eb'}
                      onMouseOut={(e) => e.target.style.background = '#f3f4f6'}
                    >
                      ×
                    </button>
                  </div>
                  
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', fontSize: '13px' }}>
                    <div style={{ 
                      background: 'linear-gradient(135deg, #dbeafe 0%, #bfdbfe 100%)',
                      padding: '10px',
                      borderRadius: '8px',
                      textAlign: 'center'
                    }}>
                      <div style={{ color: '#1e40af', fontWeight: 'bold', fontSize: '18px' }}>
                        {Math.round(selectedState.performance)}%
                      </div>
                      <div style={{ color: '#3b82f6', fontSize: '11px', marginTop: '2px' }}>Performance</div>
                    </div>
                    
                    <div style={{ 
                      background: 'linear-gradient(135deg, #dcfce7 0%, #bbf7d0 100%)',
                      padding: '10px',
                      borderRadius: '8px',
                      textAlign: 'center'
                    }}>
                      <div style={{ color: '#166534', fontWeight: 'bold', fontSize: '18px' }}>
                        {selectedState.districts}
                      </div>
                      <div style={{ color: '#16a34a', fontSize: '11px', marginTop: '2px' }}>Total Districts</div>
                    </div>
                    
                    <div style={{ 
                      background: 'linear-gradient(135deg, #fef3c7 0%, #fde68a 100%)',
                      padding: '10px',
                      borderRadius: '8px',
                      textAlign: 'center'
                    }}>
                      <div style={{ color: '#92400e', fontWeight: 'bold', fontSize: '18px' }}>
                        {(selectedState.improvement * 100).toFixed(1)}%
                      </div>
                      <div style={{ color: '#d97706', fontSize: '11px', marginTop: '2px' }}>Improvement</div>
                    </div>
                    
                    <div style={{ 
                      background: 'linear-gradient(135deg, #fce7f3 0%, #fbcfe8 100%)',
                      padding: '10px',
                      borderRadius: '8px',
                      textAlign: 'center'
                    }}>
                      <div style={{ color: '#be185d', fontWeight: 'bold', fontSize: '18px' }}>
                        {selectedState.aspirational}
                      </div>
                      <div style={{ color: '#db2777', fontSize: '11px', marginTop: '2px' }}>Aspirational</div>
                    </div>
                  </div>

                  {(selectedState.bestIndicator || selectedState.worstIndicator) && (
                    <div style={{ marginTop: '12px', paddingTop: '8px', borderTop: '1px solid #e5e7eb' }}>
                      {selectedState.bestIndicator && (
                        <div style={{ 
                          fontSize: '11px', 
                          color: '#059669', 
                          marginBottom: '4px',
                          display: 'flex',
                          alignItems: 'center'
                        }}>
                          <span style={{ marginRight: '4px' }}>🏆</span>
                          <strong>Best:</strong>
                          <span style={{ marginLeft: '4px' }}>{selectedState.bestIndicator}</span>
                        </div>
                      )}
                      {selectedState.worstIndicator && (
                        <div style={{ 
                          fontSize: '11px', 
                          color: '#dc2626',
                          display: 'flex',
                          alignItems: 'center'
                        }}>
                          <span style={{ marginRight: '4px' }}>⚠️</span>
                          <strong>Focus Area:</strong>
                          <span style={{ marginLeft: '4px' }}>{selectedState.worstIndicator}</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </Map>
          </div>
          
          
        </div>
      )}

      {/* Analysis Notes - Only show for map view */}
      {viewMode === 'map' && (
        <div className="mt-6 p-4 bg-blue-50 rounded-lg">
          <h3 className="text-lg font-semibold text-blue-800 mb-2">Analysis Notes</h3>
          <ul className="text-sm text-blue-700 space-y-1">
            <li>• Performance percentiles are calculated relative to all districts in India</li>
            <li>• Improvement rates represent annual change between NFHS-4 (2016) and NFHS-5 (2021)</li>
            <li>• Aspirational districts are part of India's development program for priority intervention</li>
            <li>• Click districts on the map to view detailed state performance metrics</li>
          </ul>
        </div>
      )}
    </div>
  );
};

export default StateWiseAnalysis;