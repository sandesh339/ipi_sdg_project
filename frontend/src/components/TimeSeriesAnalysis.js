import React, { useState, useMemo } from 'react';
import { Bar, Line } from 'react-chartjs-2';
import Map, { Source, Layer } from 'react-map-gl';
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
} from 'chart.js';

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

const MAPBOX_TOKEN = "pk.eyJ1Ijoic2FuZGVzaDMzOSIsImEiOiJjbThqazJuaTYwaTlwMmtwdzU4NzUwN3YwIn0.Kc6gPcC0Jf2rSJN4ieeimA";

// Colors for different trend directions
const TREND_COLORS = {
  'Improved': '#2ECC71',   // Green
  'Declined': '#E74C3C',   // Red
  'Stable': '#95A5A6'      // Gray
};

export default function TimeSeriesAnalysis({ data = {}, boundary = [], chartOnly = false, isModal = false }) {
  const [viewState, setViewState] = useState({
    longitude: 78.96,
    latitude: 20.59,
    zoom: 4.5
  });
  const [selectedDistrict, setSelectedDistrict] = useState(null);
  const [chartType, setChartType] = useState("bar");

  // Define click handlers first
  const handleDistrictClick = (event) => {
    if (!event.features || event.features.length === 0) return;
    
    const feature = event.features[0];
    const district = feature.properties;
    
    // Find matching district data from our districts array
    const matchingDistrict = districts.find(d => 
      (d.district === district.district_name) || 
      (d.district_name === district.district_name)
    );
    
    if (matchingDistrict) {
      // Process the district data to ensure all required fields are present
      const processedDistrict = {
        district_name: matchingDistrict.district || matchingDistrict.district_name,
        state_name: matchingDistrict.state || matchingDistrict.state_name,
        nfhs_4_value: matchingDistrict.nfhs_4_value,
        nfhs_5_value: matchingDistrict.nfhs_5_value,
        absolute_change: matchingDistrict.nfhs_5_value - matchingDistrict.nfhs_4_value,
        percentage_change: matchingDistrict.percentage_change,
        annual_change: matchingDistrict.annual_change,
        trend_direction: matchingDistrict.trend_direction,
        aspirational_status: matchingDistrict.aspirational_status,
        district_sdg_status: matchingDistrict.district_sdg_status,
        higher_is_better: matchingDistrict.higher_is_better
      };
      
      setSelectedDistrict(processedDistrict);
    }
  };

  const handleChartClick = (event, activeElements) => {
    if (activeElements && activeElements.length > 0) {
      const elementIndex = activeElements[0].index;
      const district = districts[elementIndex];
      
      // Process the district data to ensure all required fields are present
      const processedDistrict = {
        district_name: district.district || district.district_name,
        state_name: district.state || district.state_name,
        nfhs_4_value: district.nfhs_4_value,
        nfhs_5_value: district.nfhs_5_value,
        absolute_change: district.nfhs_5_value - district.nfhs_4_value,
        percentage_change: district.percentage_change,
        annual_change: district.annual_change,
        trend_direction: district.trend_direction,
        aspirational_status: district.aspirational_status,
        district_sdg_status: district.district_sdg_status,
        higher_is_better: district.higher_is_better
      };
      
      setSelectedDistrict(processedDistrict);
    }
  };

  const closePopup = () => {
    setSelectedDistrict(null);
  };

  // Extract time series data from the response
  const timeSeriesData = useMemo(() => {
    let extractedData = data;
    
    // Handle nested data structure
    if (data && data.data && Array.isArray(data.data) && data.data.length > 0) {
      if (data.data[0].result) {
        extractedData = data.data[0].result;
      }
    }
    
    return extractedData;
  }, [data]);

  // Process districts data for visualization
  const districts = useMemo(() => {
    if (!timeSeriesData || !timeSeriesData.data) return [];
    
    return Array.isArray(timeSeriesData.data) ? timeSeriesData.data : [];
  }, [timeSeriesData]);

  // Chart data for time series comparison
  const chartData = useMemo(() => {
    if (!districts.length) return null;
    
    const labels = districts.map(d => d.district || d.district_name);
    
    if (chartType === "bar") {
      return {
        labels,
        datasets: [
          {
            label: 'NFHS-4 (2016)',
            data: districts.map(d => d.nfhs_4_value || 0),
            backgroundColor: 'rgba(54, 162, 235, 0.8)',
            borderColor: 'rgba(54, 162, 235, 1)',
            borderWidth: 1,
          },
          {
            label: 'NFHS-5 (2021)',
            data: districts.map(d => d.nfhs_5_value || 0),
            backgroundColor: 'rgba(255, 99, 132, 0.8)',
            borderColor: 'rgba(255, 99, 132, 1)',
            borderWidth: 1,
          }
        ]
      };
    } else if (chartType === "change") {
      return {
        labels,
        datasets: [
          {
            label: 'Annual Change',
            data: districts.map(d => d.annual_change || 0),
            backgroundColor: districts.map(d => {
              const trend = d.trend_direction;
              return TREND_COLORS[trend] || '#95A5A6';
            }),
            borderColor: districts.map(d => {
              const trend = d.trend_direction;
              return TREND_COLORS[trend] || '#95A5A6';
            }),
            borderWidth: 1,
          }
        ]
      };
    }
    
    return null;
  }, [districts, chartType]);

  // Chart options
  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    onClick: handleChartClick,
    plugins: {
      legend: {
        position: 'top',
      },
      title: {
        display: true,
        text: `${timeSeriesData?.indicator_name || 'Time Series Comparison'} (${timeSeriesData?.time_period || '2016-2021'})`,
      },
      tooltip: {
        callbacks: {
          afterLabel: function(context) {
            const district = districts[context.dataIndex];
            if (chartType === "bar") {
              return [
                `Trend: ${district.trend_direction}`,
                `Annual Change: ${district.annual_change?.toFixed(3) || 'N/A'}`,
                `% Change: ${district.percentage_change?.toFixed(1) || 'N/A'}%`,
                `Click for detailed view`
              ];
            } else if (chartType === "change") {
              return [
                `2016: ${district.nfhs_4_value?.toFixed(2) || 'N/A'}`,
                `2021: ${district.nfhs_5_value?.toFixed(2) || 'N/A'}`,
                `% Change: ${district.percentage_change?.toFixed(1) || 'N/A'}%`,
                `Click for detailed view`
              ];
            }
            return [];
          }
        }
      }
    },
    scales: {
      y: {
        beginAtZero: true,
        title: {
          display: true,
          text: chartType === "change" ? 'Annual Change' : 'Value'
        }
      },
      x: {
        title: {
          display: true,
          text: 'Districts'
        }
      }
    }
  };

  // Summary statistics
  const summaryStats = useMemo(() => {
    if (!districts.length) return null;
    
    const improved = districts.filter(d => d.trend_direction === 'Improved').length;
    const declined = districts.filter(d => d.trend_direction === 'Declined').length;
    const stable = districts.filter(d => d.trend_direction === 'Stable').length;
    
    return {
      total: districts.length,
      improved,
      declined,
      stable,
      improvementRate: ((improved / districts.length) * 100).toFixed(1)
    };
  }, [districts]);

  if (chartOnly) {
    return (
      <div style={{ padding: "20px" }}>
        {/* Chart Type Selector */}
        <div style={{ marginBottom: "20px", display: "flex", gap: "10px", alignItems: "center" }}>
          <label style={{ fontWeight: "bold" }}>Chart Type:</label>
          <select 
            value={chartType} 
            onChange={(e) => setChartType(e.target.value)}
            style={{ 
              padding: "8px", 
              borderRadius: "4px", 
              border: "1px solid #ddd",
              backgroundColor: "white"
            }}
          >
            <option value="bar">Comparison (2016 vs 2021)</option>
            <option value="change">Annual Change</option>
          </select>
        </div>

        {/* Summary Statistics */}
        {summaryStats && (
          <div style={{ 
            marginBottom: "20px", 
            padding: "15px", 
            backgroundColor: "#f8f9fa", 
            borderRadius: "8px",
            border: "1px solid #e9ecef"
          }}>
            <h4 style={{ margin: "0 0 10px 0", color: "#2c3e50" }}>Summary Statistics</h4>
            <div style={{ display: "flex", gap: "20px", flexWrap: "wrap" }}>
              <div><strong>Total Districts:</strong> {summaryStats.total}</div>
              <div style={{ color: TREND_COLORS.Improved }}>
                <strong>Improved:</strong> {summaryStats.improved} ({((summaryStats.improved/summaryStats.total)*100).toFixed(1)}%)
              </div>
              <div style={{ color: TREND_COLORS.Declined }}>
                <strong>Declined:</strong> {summaryStats.declined} ({((summaryStats.declined/summaryStats.total)*100).toFixed(1)}%)
              </div>
              <div style={{ color: TREND_COLORS.Stable }}>
                <strong>Stable:</strong> {summaryStats.stable} ({((summaryStats.stable/summaryStats.total)*100).toFixed(1)}%)
              </div>
            </div>
          </div>
        )}

        {/* Chart */}
        {chartData && (
          <div style={{ marginBottom: "20px" }}>
            <div style={{
              backgroundColor: "#e8f4f8",
              padding: "10px",
              borderRadius: "6px",
              marginBottom: "10px",
              fontSize: "14px",
              color: "#2c3e50",
              textAlign: "center",
              border: "1px solid #bee5eb"
            }}>
              💡 <strong>Tip:</strong> Click on any bar in the chart to view detailed district information
            </div>
            <div style={{ height: "400px" }}>
              <Bar data={chartData} options={chartOptions} />
            </div>
          </div>
        )}

        {/* District Details Popup */}
        {selectedDistrict && (
          <div style={{
            position: "fixed",
            top: "0",
            left: "0",
            right: "0",
            bottom: "0",
            backgroundColor: "rgba(0, 0, 0, 0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000
          }} onClick={closePopup}>
            <div style={{
              backgroundColor: "white",
              borderRadius: "12px",
              padding: "30px",
              maxWidth: "600px",
              width: "90%",
              maxHeight: "80vh",
              overflowY: "auto",
              boxShadow: "0 10px 40px rgba(0, 0, 0, 0.3)",
              position: "relative"
            }} onClick={(e) => e.stopPropagation()}>
              
              {/* Close Button */}
              <button 
                onClick={closePopup}
                style={{
                  position: "absolute",
                  top: "15px",
                  right: "15px",
                  background: "none",
                  border: "none",
                  fontSize: "24px",
                  cursor: "pointer",
                  color: "#666",
                  padding: "5px"
                }}
                title="Close"
              >
                ✕
              </button>

              {/* Header */}
              <div style={{ marginBottom: "25px" }}>
                <h3 style={{ 
                  margin: "0 0 8px 0", 
                  color: "#2c3e50",
                  fontSize: "24px",
                  fontWeight: "700"
                }}>
                  {selectedDistrict.district_name}
                </h3>
                <p style={{ 
                  margin: "0", 
                  color: "#7f8c8d",
                  fontSize: "16px"
                }}>
                  {selectedDistrict.state_name} • {timeSeriesData?.indicator_name || 'Time Series Analysis'}
                </p>
              </div>

              {/* Time Series Values */}
              <div style={{ marginBottom: "25px" }}>
                <h4 style={{ 
                  margin: "0 0 15px 0", 
                  color: "#2c3e50",
                  fontSize: "18px",
                  borderBottom: "2px solid #3498db",
                  paddingBottom: "8px"
                }}>
                  📊 Time Series Values
                </h4>
                
                <div style={{ 
                  display: "grid", 
                  gridTemplateColumns: "1fr 1fr", 
                  gap: "15px",
                  marginBottom: "20px"
                }}>
                  <div style={{
                    backgroundColor: "#f8f9fa",
                    padding: "15px",
                    borderRadius: "8px",
                    border: "1px solid #e9ecef"
                  }}>
                    <div style={{ fontSize: "14px", color: "#6c757d", marginBottom: "5px" }}>
                      NFHS-4 (2016)
                    </div>
                    <div style={{ fontSize: "24px", fontWeight: "bold", color: "#495057" }}>
                      {selectedDistrict.nfhs_4_value?.toFixed(2) || 'N/A'}
                    </div>
                  </div>
                  
                  <div style={{
                    backgroundColor: "#f8f9fa",
                    padding: "15px",
                    borderRadius: "8px",
                    border: "1px solid #e9ecef"
                  }}>
                    <div style={{ fontSize: "14px", color: "#6c757d", marginBottom: "5px" }}>
                      NFHS-5 (2021)
                    </div>
                    <div style={{ fontSize: "24px", fontWeight: "bold", color: "#495057" }}>
                      {selectedDistrict.nfhs_5_value?.toFixed(2) || 'N/A'}
                    </div>
                  </div>
                </div>
              </div>

              {/* Change Analysis */}
              <div style={{ marginBottom: "25px" }}>
                <h4 style={{ 
                  margin: "0 0 15px 0", 
                  color: "#2c3e50",
                  fontSize: "18px",
                  borderBottom: "2px solid #e74c3c",
                  paddingBottom: "8px"
                }}>
                  📈 Change Analysis
                </h4>
                
                <div style={{ 
                  display: "grid", 
                  gridTemplateColumns: "1fr 1fr 1fr", 
                  gap: "15px",
                  marginBottom: "15px"
                }}>
                  <div style={{
                    backgroundColor: "#f8f9fa",
                    padding: "15px",
                    borderRadius: "8px",
                    border: "1px solid #e9ecef",
                    textAlign: "center"
                  }}>
                    <div style={{ fontSize: "14px", color: "#6c757d", marginBottom: "5px" }}>
                      Absolute Change
                    </div>
                    <div style={{ 
                      fontSize: "20px", 
                      fontWeight: "bold", 
                      color: selectedDistrict.absolute_change >= 0 ? "#28a745" : "#dc3545"
                    }}>
                      {selectedDistrict.absolute_change >= 0 ? '+' : ''}{selectedDistrict.absolute_change?.toFixed(2) || 'N/A'}
                    </div>
                  </div>
                  
                  <div style={{
                    backgroundColor: "#f8f9fa",
                    padding: "15px",
                    borderRadius: "8px",
                    border: "1px solid #e9ecef",
                    textAlign: "center"
                  }}>
                    <div style={{ fontSize: "14px", color: "#6c757d", marginBottom: "5px" }}>
                      Percentage Change
                    </div>
                    <div style={{ 
                      fontSize: "20px", 
                      fontWeight: "bold", 
                      color: selectedDistrict.percentage_change >= 0 ? "#28a745" : "#dc3545"
                    }}>
                      {selectedDistrict.percentage_change >= 0 ? '+' : ''}{selectedDistrict.percentage_change?.toFixed(1) || 'N/A'}%
                    </div>
                  </div>
                  
                  <div style={{
                    backgroundColor: "#f8f9fa",
                    padding: "15px",
                    borderRadius: "8px",
                    border: "1px solid #e9ecef",
                    textAlign: "center"
                  }}>
                    <div style={{ fontSize: "14px", color: "#6c757d", marginBottom: "5px" }}>
                      Annual Change
                    </div>
                    <div style={{ 
                      fontSize: "20px", 
                      fontWeight: "bold", 
                      color: selectedDistrict.annual_change >= 0 ? "#28a745" : "#dc3545"
                    }}>
                      {selectedDistrict.annual_change >= 0 ? '+' : ''}{selectedDistrict.annual_change?.toFixed(3) || 'N/A'}
                    </div>
                  </div>
                </div>

                {/* Trend Direction */}
                <div style={{
                  backgroundColor: TREND_COLORS[selectedDistrict.trend_direction] || "#95a5a6",
                  color: "white",
                  padding: "15px",
                  borderRadius: "8px",
                  textAlign: "center",
                  fontWeight: "bold",
                  fontSize: "18px"
                }}>
                  📊 Trend: {selectedDistrict.trend_direction || 'Unknown'}
                </div>
              </div>

              {/* Additional Information */}
              {(selectedDistrict.aspirational_status || selectedDistrict.district_sdg_status || selectedDistrict.higher_is_better !== undefined) && (
                <div style={{ marginBottom: "20px" }}>
                  <h4 style={{ 
                    margin: "0 0 15px 0", 
                    color: "#2c3e50",
                    fontSize: "18px",
                    borderBottom: "2px solid #f39c12",
                    paddingBottom: "8px"
                  }}>
                    ℹ️ Additional Information
                  </h4>
                  
                  <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                    {selectedDistrict.aspirational_status && (
                      <div style={{ 
                        backgroundColor: "#fff3cd", 
                        padding: "10px", 
                        borderRadius: "6px",
                        border: "1px solid #ffeaa7"
                      }}>
                        <strong>Status:</strong> {selectedDistrict.aspirational_status}
                      </div>
                    )}
                    
                    {selectedDistrict.district_sdg_status && (
                      <div style={{ 
                        backgroundColor: "#d1ecf1", 
                        padding: "10px", 
                        borderRadius: "6px",
                        border: "1px solid #bee5eb"
                      }}>
                        <strong>SDG Status:</strong> {selectedDistrict.district_sdg_status}
                      </div>
                    )}
                    
                    {selectedDistrict.higher_is_better !== undefined && (
                      <div style={{ 
                        backgroundColor: "#d4edda", 
                        padding: "10px", 
                        borderRadius: "6px",
                        border: "1px solid #c3e6cb"
                      }}>
                        <strong>Direction:</strong> {selectedDistrict.higher_is_better ? 'Higher is better' : 'Lower is better'}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Interpretation */}
              {selectedDistrict.change_interpretation && (
                <div style={{ marginBottom: "20px" }}>
                  <h4 style={{ 
                    margin: "0 0 15px 0", 
                    color: "#2c3e50",
                    fontSize: "18px",
                    borderBottom: "2px solid #9b59b6",
                    paddingBottom: "8px"
                  }}>
                    💡 Change Interpretation
                  </h4>
                  
                  <div style={{
                    backgroundColor: "#f8f9fa",
                    padding: "15px",
                    borderRadius: "8px",
                    border: "1px solid #e9ecef",
                    fontSize: "14px",
                    lineHeight: "1.6"
                  }}>
                    {selectedDistrict.change_interpretation.description || 'No interpretation available'}
                  </div>
                </div>
              )}

            </div>
          </div>
        )}

        {/* Analysis Type and Period Info */}
        <div style={{ 
          marginTop: "20px", 
          padding: "15px", 
          backgroundColor: "#e8f4f8", 
          borderRadius: "8px",
          fontSize: "14px",
          color: "#2c3e50"
        }}>
          <div><strong>Analysis Type:</strong> {timeSeriesData?.query_type || 'Time Series Comparison'}</div>
          <div><strong>Time Period:</strong> {timeSeriesData?.time_period || '2016-2021'}</div>
          {timeSeriesData?.sdg_goal && <div><strong>SDG Goal:</strong> {timeSeriesData.sdg_goal}</div>}
          {timeSeriesData?.indicators && <div><strong>Indicators:</strong> {timeSeriesData.indicators.join(', ')}</div>}
        </div>
      </div>
    );
  }

  // Full component with map would go here
  return (
    <div style={{ padding: "20px" }}>
      <h3>Time Series Analysis</h3>
      
      {!chartOnly && boundary && boundary.length > 0 && (
        <div style={{ height: "500px", marginBottom: "20px" }}>
          <Map
            {...viewState}
            onMove={evt => setViewState(evt.viewState)}
            style={{ width: "100%", height: "100%", borderRadius: "8px" }}
            mapStyle="mapbox://styles/mapbox/light-v11"
            mapboxAccessToken={MAPBOX_TOKEN}
            interactiveLayerIds={["districts-layer"]}
            onClick={handleDistrictClick}
          >
            <Source id="districts-source" type="geojson" data={{ type: "FeatureCollection", features: boundary }}>
              <Layer
                id="districts-layer"
                type="fill"
                paint={{
                  "fill-color": [
                    "match",
                    ["get", "trend_direction"],
                    "Improved", TREND_COLORS.Improved,
                    "Declined", TREND_COLORS.Declined,
                    "Stable", TREND_COLORS.Stable,
                    "#95A5A6" // default color
                  ],
                  "fill-opacity": 0.7,
                  "fill-outline-color": "#000"
                }}
              />
            </Source>
          </Map>
        </div>
      )}

      {/* Chart Type Selector */}
      <div style={{ marginBottom: "20px", display: "flex", gap: "10px", alignItems: "center" }}>
        <label style={{ fontWeight: "bold" }}>Chart Type:</label>
        <select 
          value={chartType} 
          onChange={(e) => setChartType(e.target.value)}
          style={{ 
            padding: "8px", 
            borderRadius: "4px", 
            border: "1px solid #ddd",
            backgroundColor: "white"
          }}
        >
          <option value="bar">Comparison (2016 vs 2021)</option>
          <option value="change">Annual Change</option>
        </select>
      </div>

      {/* Summary Statistics */}
      {summaryStats && (
        <div style={{ 
          marginBottom: "20px", 
          padding: "15px", 
          backgroundColor: "#f8f9fa", 
          borderRadius: "8px",
          border: "1px solid #e9ecef"
        }}>
          <h4 style={{ margin: "0 0 10px 0", color: "#2c3e50" }}>Summary Statistics</h4>
          <div style={{ display: "flex", gap: "20px", flexWrap: "wrap" }}>
            <div><strong>Total Districts:</strong> {summaryStats.total}</div>
            <div style={{ color: TREND_COLORS.Improved }}>
              <strong>Improved:</strong> {summaryStats.improved} ({((summaryStats.improved/summaryStats.total)*100).toFixed(1)}%)
            </div>
            <div style={{ color: TREND_COLORS.Declined }}>
              <strong>Declined:</strong> {summaryStats.declined} ({((summaryStats.declined/summaryStats.total)*100).toFixed(1)}%)
            </div>
            <div style={{ color: TREND_COLORS.Stable }}>
              <strong>Stable:</strong> {summaryStats.stable} ({((summaryStats.stable/summaryStats.total)*100).toFixed(1)}%)
            </div>
          </div>
        </div>
      )}

      {/* Chart */}
      {chartData && (
        <div style={{ marginBottom: "20px" }}>
          <div style={{
            backgroundColor: "#e8f4f8",
            padding: "10px",
            borderRadius: "6px",
            marginBottom: "10px",
            fontSize: "14px",
            color: "#2c3e50",
            textAlign: "center",
            border: "1px solid #bee5eb"
          }}>
            💡 <strong>Tip:</strong> Click on any bar in the chart to view detailed district information
          </div>
          <div style={{ height: "400px" }}>
            <Bar data={chartData} options={chartOptions} />
          </div>
        </div>
      )}

      {/* District Details Popup */}
      {selectedDistrict && (
        <div style={{
          position: "fixed",
          top: "0",
          left: "0",
          right: "0",
          bottom: "0",
          backgroundColor: "rgba(0, 0, 0, 0.5)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 1000
        }} onClick={closePopup}>
          <div style={{
            backgroundColor: "white",
            borderRadius: "12px",
            padding: "30px",
            maxWidth: "600px",
            width: "90%",
            maxHeight: "80vh",
            overflowY: "auto",
            boxShadow: "0 10px 40px rgba(0, 0, 0, 0.3)",
            position: "relative"
          }} onClick={(e) => e.stopPropagation()}>
            
            {/* Close Button */}
            <button 
              onClick={closePopup}
              style={{
                position: "absolute",
                top: "15px",
                right: "15px",
                background: "none",
                border: "none",
                fontSize: "24px",
                cursor: "pointer",
                color: "#666",
                padding: "5px"
              }}
              title="Close"
            >
              ✕
            </button>

            {/* Header */}
            <div style={{ marginBottom: "25px" }}>
              <h3 style={{ 
                margin: "0 0 8px 0", 
                color: "#2c3e50",
                fontSize: "24px",
                fontWeight: "700"
              }}>
                {selectedDistrict.district_name}
              </h3>
              <p style={{ 
                margin: "0", 
                color: "#7f8c8d",
                fontSize: "16px"
              }}>
                {selectedDistrict.state_name} • {timeSeriesData?.indicator_name || 'Time Series Analysis'}
              </p>
            </div>

            {/* Time Series Values */}
            <div style={{ marginBottom: "25px" }}>
              <h4 style={{ 
                margin: "0 0 15px 0", 
                color: "#2c3e50",
                fontSize: "18px",
                borderBottom: "2px solid #3498db",
                paddingBottom: "8px"
              }}>
                📊 Time Series Values
              </h4>
              
              <div style={{ 
                display: "grid", 
                gridTemplateColumns: "1fr 1fr", 
                gap: "15px",
                marginBottom: "20px"
              }}>
                <div style={{
                  backgroundColor: "#f8f9fa",
                  padding: "15px",
                  borderRadius: "8px",
                  border: "1px solid #e9ecef"
                }}>
                  <div style={{ fontSize: "14px", color: "#6c757d", marginBottom: "5px" }}>
                    NFHS-4 (2016)
                  </div>
                  <div style={{ fontSize: "24px", fontWeight: "bold", color: "#495057" }}>
                    {selectedDistrict.nfhs_4_value?.toFixed(2) || 'N/A'}
                  </div>
                </div>
                
                <div style={{
                  backgroundColor: "#f8f9fa",
                  padding: "15px",
                  borderRadius: "8px",
                  border: "1px solid #e9ecef"
                }}>
                  <div style={{ fontSize: "14px", color: "#6c757d", marginBottom: "5px" }}>
                    NFHS-5 (2021)
                  </div>
                  <div style={{ fontSize: "24px", fontWeight: "bold", color: "#495057" }}>
                    {selectedDistrict.nfhs_5_value?.toFixed(2) || 'N/A'}
                  </div>
                </div>
              </div>
            </div>

            {/* Change Analysis */}
            <div style={{ marginBottom: "25px" }}>
              <h4 style={{ 
                margin: "0 0 15px 0", 
                color: "#2c3e50",
                fontSize: "18px",
                borderBottom: "2px solid #e74c3c",
                paddingBottom: "8px"
              }}>
                📈 Change Analysis
              </h4>
              
              <div style={{ 
                display: "grid", 
                gridTemplateColumns: "1fr 1fr 1fr", 
                gap: "15px",
                marginBottom: "15px"
              }}>
                <div style={{
                  backgroundColor: "#f8f9fa",
                  padding: "15px",
                  borderRadius: "8px",
                  border: "1px solid #e9ecef",
                  textAlign: "center"
                }}>
                  <div style={{ fontSize: "14px", color: "#6c757d", marginBottom: "5px" }}>
                    Absolute Change
                  </div>
                  <div style={{ 
                    fontSize: "20px", 
                    fontWeight: "bold", 
                    color: selectedDistrict.absolute_change >= 0 ? "#28a745" : "#dc3545"
                  }}>
                    {selectedDistrict.absolute_change >= 0 ? '+' : ''}{selectedDistrict.absolute_change?.toFixed(2) || 'N/A'}
                  </div>
                </div>
                
                <div style={{
                  backgroundColor: "#f8f9fa",
                  padding: "15px",
                  borderRadius: "8px",
                  border: "1px solid #e9ecef",
                  textAlign: "center"
                }}>
                  <div style={{ fontSize: "14px", color: "#6c757d", marginBottom: "5px" }}>
                    Percentage Change
                  </div>
                  <div style={{ 
                    fontSize: "20px", 
                    fontWeight: "bold", 
                    color: selectedDistrict.percentage_change >= 0 ? "#28a745" : "#dc3545"
                  }}>
                    {selectedDistrict.percentage_change >= 0 ? '+' : ''}{selectedDistrict.percentage_change?.toFixed(1) || 'N/A'}%
                  </div>
                </div>
                
                <div style={{
                  backgroundColor: "#f8f9fa",
                  padding: "15px",
                  borderRadius: "8px",
                  border: "1px solid #e9ecef",
                  textAlign: "center"
                }}>
                  <div style={{ fontSize: "14px", color: "#6c757d", marginBottom: "5px" }}>
                    Annual Change
                  </div>
                  <div style={{ 
                    fontSize: "20px", 
                    fontWeight: "bold", 
                    color: selectedDistrict.annual_change >= 0 ? "#28a745" : "#dc3545"
                  }}>
                    {selectedDistrict.annual_change >= 0 ? '+' : ''}{selectedDistrict.annual_change?.toFixed(3) || 'N/A'}
                  </div>
                </div>
              </div>

              {/* Trend Direction */}
              <div style={{
                backgroundColor: TREND_COLORS[selectedDistrict.trend_direction] || "#95a5a6",
                color: "white",
                padding: "15px",
                borderRadius: "8px",
                textAlign: "center",
                fontWeight: "bold",
                fontSize: "18px"
              }}>
                📊 Trend: {selectedDistrict.trend_direction || 'Unknown'}
              </div>
            </div>

            {/* Additional Information */}
            {(selectedDistrict.aspirational_status || selectedDistrict.district_sdg_status || selectedDistrict.higher_is_better !== undefined) && (
              <div style={{ marginBottom: "20px" }}>
                <h4 style={{ 
                  margin: "0 0 15px 0", 
                  color: "#2c3e50",
                  fontSize: "18px",
                  borderBottom: "2px solid #f39c12",
                  paddingBottom: "8px"
                }}>
                  ℹ️ Additional Information
                </h4>
                
                <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                  {selectedDistrict.aspirational_status && (
                    <div style={{ 
                      backgroundColor: "#fff3cd", 
                      padding: "10px", 
                      borderRadius: "6px",
                      border: "1px solid #ffeaa7"
                    }}>
                      <strong>Status:</strong> {selectedDistrict.aspirational_status}
                    </div>
                  )}
                  
                  {selectedDistrict.district_sdg_status && (
                    <div style={{ 
                      backgroundColor: "#d1ecf1", 
                      padding: "10px", 
                      borderRadius: "6px",
                      border: "1px solid #bee5eb"
                    }}>
                      <strong>SDG Status:</strong> {selectedDistrict.district_sdg_status}
                    </div>
                  )}
                  
                  {selectedDistrict.higher_is_better !== undefined && (
                    <div style={{ 
                      backgroundColor: "#d4edda", 
                      padding: "10px", 
                      borderRadius: "6px",
                      border: "1px solid #c3e6cb"
                    }}>
                      <strong>Direction:</strong> {selectedDistrict.higher_is_better ? 'Higher is better' : 'Lower is better'}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Interpretation */}
            {selectedDistrict.change_interpretation && (
              <div style={{ marginBottom: "20px" }}>
                <h4 style={{ 
                  margin: "0 0 15px 0", 
                  color: "#2c3e50",
                  fontSize: "18px",
                  borderBottom: "2px solid #9b59b6",
                  paddingBottom: "8px"
                }}>
                  💡 Change Interpretation
                </h4>
                
                <div style={{
                  backgroundColor: "#f8f9fa",
                  padding: "15px",
                  borderRadius: "8px",
                  border: "1px solid #e9ecef",
                  fontSize: "14px",
                  lineHeight: "1.6"
                }}>
                  {selectedDistrict.change_interpretation.description || 'No interpretation available'}
                </div>
              </div>
            )}

          </div>
        </div>
      )}

      {/* Analysis Type and Period Info */}
      <div style={{ 
        marginTop: "20px", 
        padding: "15px", 
        backgroundColor: "#e8f4f8", 
        borderRadius: "8px",
        fontSize: "14px",
        color: "#2c3e50"
      }}>
        <div><strong>Analysis Type:</strong> {timeSeriesData?.query_type || 'Time Series Comparison'}</div>
        <div><strong>Time Period:</strong> {timeSeriesData?.time_period || '2016-2021'}</div>
        {timeSeriesData?.sdg_goal && <div><strong>SDG Goal:</strong> {timeSeriesData.sdg_goal}</div>}
        {timeSeriesData?.indicators && <div><strong>Indicators:</strong> {timeSeriesData.indicators.join(', ')}</div>}
      </div>
    </div>
  );
} 