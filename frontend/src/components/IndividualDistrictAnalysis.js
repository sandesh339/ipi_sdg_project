import React, { useState, useMemo, useCallback } from 'react';
import { Bar, Line, Doughnut } from 'react-chartjs-2';
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
  ArcElement,
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
  ArcElement
);

const MAPBOX_TOKEN = "pk.eyJ1Ijoic2FuZGVzaDMzOSIsImEiOiJjbThqazJuaTYwaTlwMmtwdzU4NzUwN3YwIn0.Kc6gPcC0Jf2rSJN4ieeimA";

// Color schemes for different visualization types
const SDG_COLORS = {
  1: '#E74C3C', 2: '#F39C12', 3: '#2ECC71', 4: '#3498DB', 5: '#E67E22',
  6: '#1ABC9C', 7: '#F1C40F', 8: '#9B59B6', 9: '#34495E', 10: '#E91E63',
  11: '#FF9800', 12: '#4CAF50', 13: '#607D8B', 14: '#00BCD4', 15: '#8BC34A',
  16: '#FF5722', 17: '#795548'
};

const TREND_COLORS = {
  improvement: '#2ECC71',
  deterioration: '#E74C3C',
  stable: '#95A5A6'
};

export default function IndividualDistrictAnalysis({ data = {}, boundary = [], chartOnly = false, isModal = false }) {
  console.log('IndividualDistrictAnalysis received data:', data);

  const [viewState, setViewState] = useState({
    longitude: 78.96,
    latitude: 20.59,
    zoom: 5
  });
  const [selectedSDGGoal, setSelectedSDGGoal] = useState(null);
  const [chartType, setChartType] = useState("comparison"); // comparison, trends, summary
  const [showIndicatorSelection, setShowIndicatorSelection] = useState(false);

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

  // Check if this is an individual district query
  const isIndividualDistrict = useMemo(() => {
    return actualData?.analysis_type === "individual_district" || 
           actualData?.map_type === "individual_district_analysis" ||
           (actualData?.district && actualData?.sdg_goals_data);
  }, [actualData]);

  // Check if this is a best/worst district query
  const isBestWorstDistrict = useMemo(() => {
    return actualData?.analysis_type === "best_worst_district" ||
           actualData?.analysis_type === "overall_sdg_performance" ||
           actualData?.map_type === "best_worst_district_analysis" ||
           actualData?.map_type === "best_worst_overall_sdg" ||
           (actualData?.performance_type && (actualData?.performance_type === "Best" || actualData?.performance_type === "Worst"));
  }, [actualData]);

  // Check if this is an indicator selection prompt
  const isIndicatorSelectionPrompt = useMemo(() => {
    return actualData?.needs_indicator_selection || 
           (actualData?.available_indicators && Array.isArray(actualData.available_indicators));
  }, [actualData]);

  // Extract district information
  const districtInfo = useMemo(() => {
    if (isIndividualDistrict) {
      return {
        name: actualData.district,
        state: actualData.state,
        year: actualData.year || 2021,
        summary: actualData.summary || {},
        sdgGoalsData: actualData.sdg_goals_data || []
      };
    } else if (isBestWorstDistrict) {
      // Check if this is overall SDG performance (multiple indicators)
      if (actualData.map_type === "best_worst_overall_sdg" && actualData.data && actualData.data.length > 0) {
        const districtData = actualData.data[0];
        
        // Convert to sdg_goals_data format for compatibility
        const sdgGoalsData = [{
          sdg_goal: actualData.sdg_goal,
          total_indicators: actualData.indicators_available,
          indicators: districtData.indicators || []
        }];
        
        return {
          name: actualData.district,
          state: actualData.state,
          year: actualData.year || 2021,
          performanceType: actualData.performance_type,
          sdgGoal: actualData.sdg_goal,
          performancePercentile: actualData.performance_percentile,
          indicatorsAvailable: actualData.indicators_available,
          aspirationalStatus: actualData.aspirational_status,
          districtSdgStatus: actualData.district_sdg_status,
          // For overall SDG, we show aggregated data
          isOverallSDG: true,
          indicators: districtData.indicators || [],
          overallAnnualChange: actualData.annual_change,
          overallChangeInterpretation: actualData.change_interpretation,
          // Add sdgGoalsData for compatibility with existing chart logic
          sdgGoalsData: sdgGoalsData,
          // Summary data for overall performance
          summary: {
            improving_indicators: districtData.overall_trend_analysis?.improvement_count || 0,
            deteriorating_indicators: districtData.overall_trend_analysis?.deterioration_count || 0,
            stable_indicators: 0,
            improvement_rate: (districtData.overall_trend_analysis?.improvement_ratio || 0) * 100
          }
        };
      } else {
        // Individual indicator data (for best/worst specific indicator)
        return {
          name: actualData.district,
          state: actualData.state,
          year: actualData.year || 2021,
          performanceType: actualData.performance_type,
          sdgGoal: actualData.sdg_goal,
          indicatorName: actualData.indicator_name,
          indicatorFullName: actualData.indicator_full_name,
          indicatorValue: actualData.indicator_value,
          nfhs4Value: actualData.nfhs_4_value,
          nfhs5Value: actualData.nfhs_5_value,
          annualChange: actualData.annual_change,
          changeInterpretation: actualData.change_interpretation,
          isOverallSDG: false
        };
      }
    }
    return null;
  }, [actualData, isIndividualDistrict, isBestWorstDistrict]);

  // Process boundary data for map visualization
  const mapFeatures = useMemo(() => {
    if (!districtInfo || !boundary || boundary.length === 0) return [];

    const districtBoundary = boundary.find(b => 
      b.district?.toLowerCase() === districtInfo.name?.toLowerCase() ||
      b.district_name?.toLowerCase() === districtInfo.name?.toLowerCase()
    );

    if (!districtBoundary) {
      return [];
    }

    return [{
      type: "Feature",
      geometry: districtBoundary.geometry || districtBoundary,
      properties: {
        district_name: districtInfo.name,
        state_name: districtInfo.state,
        fill_color: "#3498DB",
        stroke_color: "#2980B9"
      }
    }];
  }, [districtInfo, boundary]);

  // Set initial map view to district location
  React.useEffect(() => {
    if (mapFeatures.length > 0 && mapFeatures[0].geometry) {
      const geometry = mapFeatures[0].geometry;
      
      // Calculate bounds for the district
      let minLng = Infinity, maxLng = -Infinity;
      let minLat = Infinity, maxLat = -Infinity;
      
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

      if (geometry.coordinates) {
        extractCoordinates(geometry.coordinates);
        
        const centerLng = (minLng + maxLng) / 2;
        const centerLat = (minLat + maxLat) / 2;
        
        setViewState(prev => ({
          ...prev,
          longitude: centerLng,
          latitude: centerLat,
          zoom: 8
        }));
      }
    }
  }, [mapFeatures]);

  // Generate chart data for individual district analysis
  const generateComparisonChartData = useCallback(() => {
    if (!isIndividualDistrict || !districtInfo?.sdgGoalsData) return null;

    const currentGoal = selectedSDGGoal ? 
      districtInfo.sdgGoalsData.find(g => g.sdg_goal === selectedSDGGoal) :
      districtInfo.sdgGoalsData[0];

    if (!currentGoal) return null;

    const indicators = currentGoal.indicators || [];
    
    return {
      labels: indicators.map(ind => ind.indicator_name || ind.indicator_full_name?.substring(0, 20)),
      datasets: [
        {
          label: 'NFHS-4 (2016)',
          data: indicators.map(ind => ind.nfhs_4_value),
          backgroundColor: '#3498DB',
          borderColor: '#2980B9',
          borderWidth: 1
        },
        {
          label: 'NFHS-5 (2021)',
          data: indicators.map(ind => ind.nfhs_5_value),
          backgroundColor: '#2ECC71',
          borderColor: '#27AE60',
          borderWidth: 1
        }
      ]
    };
  }, [isIndividualDistrict, districtInfo, selectedSDGGoal]);

  // Generate trend analysis chart
  const generateTrendChartData = useCallback(() => {
    if (!isIndividualDistrict || !districtInfo?.sdgGoalsData) return null;

    const currentGoal = selectedSDGGoal ? 
      districtInfo.sdgGoalsData.find(g => g.sdg_goal === selectedSDGGoal) :
      districtInfo.sdgGoalsData[0];

    if (!currentGoal) return null;

    const indicators = currentGoal.indicators || [];
    
    return {
      labels: indicators.map(ind => ind.indicator_name),
      datasets: [
        {
          label: 'Annual Change',
          data: indicators.map(ind => ind.annual_change),
          backgroundColor: indicators.map(ind => {
            const interp = ind.change_interpretation;
            if (interp?.is_improvement === true) return TREND_COLORS.improvement;
            if (interp?.is_improvement === false) return TREND_COLORS.deterioration;
            return TREND_COLORS.stable;
          }),
          borderColor: indicators.map(ind => {
            const interp = ind.change_interpretation;
            if (interp?.is_improvement === true) return '#27AE60';
            if (interp?.is_improvement === false) return '#C0392B';
            return '#7F8C8D';
          }),
          borderWidth: 2
        }
      ]
    };
  }, [isIndividualDistrict, districtInfo, selectedSDGGoal]);

  // Generate summary chart for overall performance
  const generateSummaryChartData = useCallback(() => {
    if (!isIndividualDistrict || !districtInfo?.summary) return null;

    const summary = districtInfo.summary;
    const data = {
      labels: ['Improving', 'Deteriorating', 'Stable'],
      datasets: [
        {
          data: [
            summary.improving_indicators || 0,
            summary.deteriorating_indicators || 0,
            summary.stable_indicators || 0
          ],
          backgroundColor: [
            TREND_COLORS.improvement,
            TREND_COLORS.deterioration,
            TREND_COLORS.stable
          ],
          borderColor: [
            '#27AE60',
            '#C0392B',
            '#7F8C8D'
          ],
          borderWidth: 2
        }
      ]
    };

    return data;
  }, [isIndividualDistrict, districtInfo]);

  // Generate chart data for best/worst district display
  const generateBestWorstChartData = useCallback(() => {
    if (!isBestWorstDistrict || !districtInfo) {
      return null;
    }

    // Handle overall SDG performance (multiple indicators) - use the same logic as comparison chart
    if (districtInfo.isOverallSDG && districtInfo.sdgGoalsData && districtInfo.sdgGoalsData.length > 0) {
      const currentGoal = districtInfo.sdgGoalsData[0];
      const indicators = currentGoal.indicators || [];
      
      return {
        labels: indicators.map(ind => ind.indicator_name || ind.indicator_full_name?.substring(0, 20)),
        datasets: [
          {
            label: 'NFHS-4 (2016)',
            data: indicators.map(ind => ind.nfhs_4_value),
            backgroundColor: '#3498DB',
            borderColor: '#2980B9',
            borderWidth: 1
          },
          {
            label: 'NFHS-5 (2021)',
            data: indicators.map(ind => ind.nfhs_5_value),
            backgroundColor: '#2ECC71',
            borderColor: '#27AE60',
            borderWidth: 1
          }
        ]
      };
    } else {
      // Handle individual indicator data
      return {
        labels: ['NFHS-4 (2016)', 'NFHS-5 (2021)'],
        datasets: [
          {
            label: districtInfo.indicatorFullName || districtInfo.indicatorName || 'Indicator Value',
            data: [districtInfo.nfhs4Value, districtInfo.nfhs5Value],
            borderColor: districtInfo.changeInterpretation?.is_improvement ? 
              TREND_COLORS.improvement : TREND_COLORS.deterioration,
            backgroundColor: districtInfo.changeInterpretation?.is_improvement ? 
              TREND_COLORS.improvement + '20' : TREND_COLORS.deterioration + '20',
            borderWidth: 3,
            pointRadius: 6,
            pointHoverRadius: 8,
            tension: 0.2
          }
        ]
      };
    }
  }, [isBestWorstDistrict, districtInfo]);

  // Chart options
  const chartOptions = useMemo(() => {
    const baseOptions = {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'top',
          labels: {
            font: { size: 12 },
            color: '#2C3E50'
          }
        },
        title: {
          display: true,
          text: chartType === 'comparison' ? 'NFHS-4 vs NFHS-5 Comparison' :
                chartType === 'trends' ? 'Annual Change Trends' :
                'Performance Summary',
          font: { size: 16, weight: 'bold' },
          color: '#2C3E50'
        },
        tooltip: {
          callbacks: {
            afterLabel: function(context) {
              if (chartType === 'trends' && isIndividualDistrict && districtInfo) {
                const dataIndex = context.dataIndex;
                const currentGoal = selectedSDGGoal ? 
                  districtInfo.sdgGoalsData.find(g => g.sdg_goal === selectedSDGGoal) :
                  districtInfo.sdgGoalsData[0];
                const indicator = currentGoal?.indicators[dataIndex];
                return indicator?.change_interpretation?.description || '';
              }
              return '';
            }
          }
        }
      }
    };

    // Add scales only for bar and line charts (not for doughnut)
    if (chartType !== 'summary') {
      baseOptions.scales = {
        y: {
          beginAtZero: false,
          ticks: { color: '#2C3E50' },
          grid: { color: '#ECF0F1' }
        },
        x: {
          ticks: { 
            color: '#2C3E50',
            maxRotation: 45,
            minRotation: 0
          },
          grid: { color: '#ECF0F1' }
        }
      };
    }

    return baseOptions;
  }, [chartType, isIndividualDistrict, districtInfo, selectedSDGGoal]);

  // Render indicator selection interface
  const renderIndicatorSelection = () => {
    if (!isIndicatorSelectionPrompt) return null;

    return (
      <div style={{
        padding: '24px',
        background: 'linear-gradient(135deg, #f8f9fa 0%, #e9ecef 100%)',
        borderRadius: '12px',
        margin: '16px 0'
      }}>
        <h3 style={{ 
          color: '#2C3E50', 
          marginBottom: '16px',
          display: 'flex',
          alignItems: 'center',
          gap: '8px'
        }}>
          🎯 Indicator Selection for {data.district}, {data.state}
        </h3>
        
        <p style={{ color: '#5D6D7E', marginBottom: '20px' }}>
          {data.message}
        </p>

        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
          gap: '12px',
          marginBottom: '20px'
        }}>
          {data.available_indicators?.map((indicator, index) => (
            <div
              key={index}
              style={{
                padding: '16px',
                background: indicator.has_data ? '#ffffff' : '#f8f9fa',
                border: indicator.has_data ? '2px solid #3498DB' : '2px solid #BDC3C7',
                borderRadius: '8px',
                cursor: indicator.has_data ? 'pointer' : 'not-allowed',
                opacity: indicator.has_data ? 1 : 0.7,
                transition: 'all 0.3s ease'
              }}
              onMouseEnter={(e) => {
                if (indicator.has_data) {
                  e.target.style.transform = 'translateY(-2px)';
                  e.target.style.boxShadow = '0 4px 12px rgba(52, 152, 219, 0.3)';
                }
              }}
              onMouseLeave={(e) => {
                e.target.style.transform = 'translateY(0)';
                e.target.style.boxShadow = 'none';
              }}
            >
              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: '8px'
              }}>
                <span style={{
                  fontWeight: 'bold',
                  color: '#2C3E50',
                  fontSize: '14px'
                }}>
                  {indicator.indicator_number}
                </span>
                <span style={{
                  fontSize: '12px',
                  padding: '4px 8px',
                  borderRadius: '12px',
                  background: indicator.has_data ? '#E8F8F5' : '#FADBD8',
                  color: indicator.has_data ? '#138D75' : '#C0392B'
                }}>
                  {indicator.has_data ? '✅ Data Available' : '❌ No Data'}
                </span>
              </div>
              <h4 style={{
                color: '#34495E',
                fontSize: '13px',
                margin: '8px 0',
                lineHeight: '1.4'
              }}>
                {indicator.short_name}
              </h4>
              <p style={{
                color: '#7F8C8D',
                fontSize: '12px',
                margin: 0,
                lineHeight: '1.3'
              }}>
                {indicator.full_name}
              </p>
            </div>
          ))}
        </div>

        <div style={{
          display: 'flex',
          gap: '12px',
          flexWrap: 'wrap'
        }}>
          {data.selection_options?.map((option, index) => (
            <button
              key={index}
              style={{
                padding: '12px 20px',
                background: 'linear-gradient(135deg, #3498DB 0%, #2980B9 100%)',
                color: 'white',
                border: 'none',
                borderRadius: '8px',
                cursor: 'pointer',
                fontSize: '14px',
                fontWeight: '600',
                transition: 'all 0.3s ease'
              }}
              onMouseEnter={(e) => {
                e.target.style.transform = 'translateY(-2px)';
                e.target.style.boxShadow = '0 4px 12px rgba(52, 152, 219, 0.4)';
              }}
              onMouseLeave={(e) => {
                e.target.style.transform = 'translateY(0)';
                e.target.style.boxShadow = 'none';
              }}
            >
              {option}
            </button>
          ))}
        </div>
      </div>
    );
  };

  // Render district summary card
  const renderDistrictSummary = () => {
    if (!districtInfo) return null;

    return (
      <div style={{
        background: 'linear-gradient(135deg, #ffffff 0%, #f8f9fa 100%)',
        padding: '24px',
        borderRadius: '12px',
        border: '2px solid #3498DB',
        marginBottom: '20px',
        boxShadow: '0 4px 12px rgba(52, 152, 219, 0.1)'
      }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: '16px'
        }}>
          <div>
            <h2 style={{
              color: '#2C3E50',
              margin: 0,
              fontSize: '24px',
              fontWeight: 'bold'
            }}>
              📍 {districtInfo.name}
            </h2>
            <p style={{
              color: '#5D6D7E',
              margin: '4px 0 0 0',
              fontSize: '16px'
            }}>
              {districtInfo.state} • Data Year: {districtInfo.year}
            </p>
          </div>
          {isBestWorstDistrict && (
            <div style={{
              background: districtInfo.performanceType === 'Best' ? 
                'linear-gradient(135deg, #2ECC71 0%, #27AE60 100%)' :
                'linear-gradient(135deg, #E74C3C 0%, #C0392B 100%)',
              color: 'white',
              padding: '12px 20px',
              borderRadius: '8px',
              fontSize: '16px',
              fontWeight: 'bold'
            }}>
              {districtInfo.performanceType === 'Best' ? '🏆' : '⚠️'} {districtInfo.performanceType} Performing
            </div>
          )}
        </div>

        {isIndividualDistrict && districtInfo.summary && (
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
            gap: '16px',
            marginBottom: '16px'
          }}>
            <div style={{ textAlign: 'center', padding: '12px', background: '#E8F6F3', borderRadius: '8px' }}>
              <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#138D75' }}>
                {districtInfo.summary.improving_indicators || 0}
              </div>
              <div style={{ fontSize: '12px', color: '#5D6D7E' }}>Improving</div>
            </div>
            <div style={{ textAlign: 'center', padding: '12px', background: '#FADBD8', borderRadius: '8px' }}>
              <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#C0392B' }}>
                {districtInfo.summary.deteriorating_indicators || 0}
              </div>
              <div style={{ fontSize: '12px', color: '#5D6D7E' }}>Deteriorating</div>
            </div>
            <div style={{ textAlign: 'center', padding: '12px', background: '#F4F6F6', borderRadius: '8px' }}>
              <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#566573' }}>
                {districtInfo.summary.stable_indicators || 0}
              </div>
              <div style={{ fontSize: '12px', color: '#5D6D7E' }}>Stable</div>
            </div>
            <div style={{ textAlign: 'center', padding: '12px', background: '#EBF5FB', borderRadius: '8px' }}>
              <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#2980B9' }}>
                {districtInfo.summary.improvement_rate || 0}%
              </div>
              <div style={{ fontSize: '12px', color: '#5D6D7E' }}>Improvement Rate</div>
            </div>
          </div>
        )}

        {isBestWorstDistrict && !districtInfo.isOverallSDG && (
          <div style={{
            background: '#F8F9FA',
            padding: '16px',
            borderRadius: '8px',
            marginTop: '16px'
          }}>
            <h4 style={{ color: '#2C3E50', margin: '0 0 12px 0' }}>
              {districtInfo.indicatorFullName || districtInfo.indicatorName}
            </h4>
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
              gap: '12px'
            }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '18px', fontWeight: 'bold', color: '#3498DB' }}>
                  {(() => {
                    console.log("NFHS-4 Value rendering:", districtInfo.nfhs4Value, typeof districtInfo.nfhs4Value);
                    return districtInfo.nfhs4Value !== null && districtInfo.nfhs4Value !== undefined ? 
                      districtInfo.nfhs4Value.toFixed(2) : 'N/A';
                  })()}
                </div>
                <div style={{ fontSize: '12px', color: '#5D6D7E' }}>NFHS-4 (2016)</div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '18px', fontWeight: 'bold', color: '#2ECC71' }}>
                  {(() => {
                    console.log("NFHS-5 Value rendering:", districtInfo.nfhs5Value, typeof districtInfo.nfhs5Value);
                    return districtInfo.nfhs5Value !== null && districtInfo.nfhs5Value !== undefined ? 
                      districtInfo.nfhs5Value.toFixed(2) : 'N/A';
                  })()}
                </div>
                <div style={{ fontSize: '12px', color: '#5D6D7E' }}>NFHS-5 (2021)</div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ 
                  fontSize: '18px', 
                  fontWeight: 'bold', 
                  color: districtInfo.changeInterpretation?.is_improvement ? '#2ECC71' : '#E74C3C'
                }}>
                  {(() => {
                    console.log("Annual Change rendering:", districtInfo.annualChange, typeof districtInfo.annualChange);
                    const icon = decodeUnicode(districtInfo.changeInterpretation?.trend_icon) || '';
                    const change = districtInfo.annualChange !== null && districtInfo.annualChange !== undefined ? 
                      districtInfo.annualChange.toFixed(2) : 'N/A';
                    return `${icon} ${change}`;
                  })()}
                </div>
                <div style={{ fontSize: '12px', color: '#5D6D7E' }}>Annual Change</div>
              </div>
            </div>
            {districtInfo.changeInterpretation?.description && (
              <p style={{
                margin: '12px 0 0 0',
                padding: '8px',
                background: '#ffffff',
                borderRadius: '6px',
                fontSize: '13px',
                color: '#34495E',
                border: '1px solid #E8F6F3'
              }}>
                {districtInfo.changeInterpretation.description}
              </p>
            )}
          </div>
        )}

        {isBestWorstDistrict && districtInfo.isOverallSDG && (
          <div style={{
            background: '#F8F9FA',
            padding: '16px',
            borderRadius: '8px',
            marginTop: '16px'
          }}>
            <h4 style={{ color: '#2C3E50', margin: '0 0 12px 0' }}>
              Overall SDG {districtInfo.sdgGoal} Performance
            </h4>
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
              gap: '12px'
            }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '18px', fontWeight: 'bold', color: '#3498DB' }}>
                  {districtInfo.performancePercentile ? districtInfo.performancePercentile.toFixed(1) + '%' : 'N/A'}
                </div>
                <div style={{ fontSize: '12px', color: '#5D6D7E' }}>Performance Percentile</div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '18px', fontWeight: 'bold', color: '#2ECC71' }}>
                  {districtInfo.indicatorsAvailable || 'N/A'}
                </div>
                <div style={{ fontSize: '12px', color: '#5D6D7E' }}>Indicators Available</div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ 
                  fontSize: '18px', 
                  fontWeight: 'bold', 
                  color: districtInfo.overallChangeInterpretation?.is_improvement ? '#2ECC71' : '#E74C3C'
                }}>
                  {(() => {
                    const icon = decodeUnicode(districtInfo.overallChangeInterpretation?.trend_icon) || '';
                    const change = districtInfo.overallAnnualChange !== null && districtInfo.overallAnnualChange !== undefined ? 
                      districtInfo.overallAnnualChange.toFixed(2) : 'N/A';
                    return `${icon} ${change}`;
                  })()}
                </div>
                <div style={{ fontSize: '12px', color: '#5D6D7E' }}>Overall Annual Change</div>
              </div>
            </div>
            {districtInfo.overallChangeInterpretation?.description && (
              <p style={{
                margin: '12px 0 0 0',
                padding: '8px',
                background: '#ffffff',
                borderRadius: '6px',
                fontSize: '13px',
                color: '#34495E',
                border: '1px solid #E8F6F3'
              }}>
                {districtInfo.overallChangeInterpretation.description}
              </p>
            )}
          </div>
        )}
      </div>
    );
  };

  // Main render logic
  if (isIndicatorSelectionPrompt) {
    return (
      <div style={{ padding: chartOnly ? '0' : '20px' }}>
        {renderIndicatorSelection()}
      </div>
    );
  }

  if (!isIndividualDistrict && !isBestWorstDistrict) {
    return (
      <div style={{ 
        padding: '20px', 
        textAlign: 'center',
        color: '#7F8C8D'
      }}>
        This component is designed for individual district analysis.
      </div>
    );
  }

  return (
    <div style={{ 
      padding: chartOnly ? '0' : '20px',
      fontFamily: 'system-ui, -apple-system, sans-serif'
    }}>
      {renderDistrictSummary()}

      {/* SDG Goal Selection for Individual Districts */}
      {isIndividualDistrict && districtInfo.sdgGoalsData.length > 1 && !isModal && (
        <div style={{
          marginBottom: '20px',
          padding: '16px',
          background: '#F8F9FA',
          borderRadius: '8px'
        }}>
          <label style={{
            display: 'block',
            marginBottom: '8px',
            fontWeight: 'bold',
            color: '#2C3E50'
          }}>
            Select SDG Goal:
          </label>
          <select
            value={selectedSDGGoal || districtInfo.sdgGoalsData[0]?.sdg_goal || ''}
            onChange={(e) => setSelectedSDGGoal(parseInt(e.target.value))}
            style={{
              padding: '8px 12px',
              borderRadius: '6px',
              border: '2px solid #BDC3C7',
              fontSize: '14px',
              minWidth: '200px'
            }}
          >
            {districtInfo.sdgGoalsData.map(goal => (
              <option key={goal.sdg_goal} value={goal.sdg_goal}>
                SDG Goal {goal.sdg_goal} ({goal.total_indicators} indicators)
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Chart Section - Only show when not in map mode */}
      {(chartOnly || (!isModal && isIndividualDistrict)) && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: isModal ? '1fr' : 'repeat(auto-fit, minmax(400px, 1fr))',
          gap: '20px',
          marginBottom: '20px'
        }}>
          {/* Chart Controls for Individual Districts */}
          {isIndividualDistrict && (
            <div style={{
              background: '#ffffff',
              padding: '20px',
              borderRadius: '12px',
              border: '1px solid #E8F4FD',
              boxShadow: '0 2px 8px rgba(52, 152, 219, 0.1)'
            }}>
              <div style={{
                display: 'flex',
                gap: '8px',
                marginBottom: '16px',
                flexWrap: 'wrap'
              }}>
                {['comparison', 'trends', 'summary'].map(type => (
                  <button
                    key={type}
                    onClick={() => setChartType(type)}
                    style={{
                      padding: '8px 16px',
                      background: chartType === type ? 
                        'linear-gradient(135deg, #3498DB 0%, #2980B9 100%)' : '#F8F9FA',
                      color: chartType === type ? 'white' : '#2C3E50',
                      border: chartType === type ? 'none' : '1px solid #BDC3C7',
                      borderRadius: '6px',
                      cursor: 'pointer',
                      fontSize: '12px',
                      fontWeight: '600',
                      transition: 'all 0.3s ease'
                    }}
                  >
                    {type.charAt(0).toUpperCase() + type.slice(1)}
                  </button>
                ))}
              </div>

              <div style={{ height: '300px' }}>
                {chartType === 'comparison' && generateComparisonChartData() && (
                  <Bar data={generateComparisonChartData()} options={chartOptions} />
                )}
                {chartType === 'trends' && generateTrendChartData() && (
                  <Bar data={generateTrendChartData()} options={chartOptions} />
                )}
                {chartType === 'summary' && generateSummaryChartData() && (
                  <Doughnut data={generateSummaryChartData()} options={chartOptions} />
                )}
              </div>
            </div>
          )}

          {/* Chart for Best/Worst Districts */}
          {isBestWorstDistrict && generateBestWorstChartData() && (
            <div style={{
              background: '#ffffff',
              padding: '20px',
              borderRadius: '12px',
              border: '1px solid #E8F4FD',
              boxShadow: '0 2px 8px rgba(52, 152, 219, 0.1)'
            }}>
              <h3 style={{ 
                color: '#2C3E50', 
                marginBottom: '16px',
                fontSize: '16px'
              }}>
                {districtInfo.performanceType} Performing District - {districtInfo.isOverallSDG ? 'Indicator Comparison' : 'Trend Analysis'}
              </h3>
              <div style={{ height: '300px' }}>
                {districtInfo.isOverallSDG ? (
                  <Bar data={generateBestWorstChartData()} options={chartOptions} />
                ) : (
                  <Line data={generateBestWorstChartData()} options={chartOptions} />
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Map Section - Only show when not in chart mode */}
      {!chartOnly && mapFeatures.length > 0 && (
        <div style={{
          background: '#ffffff',
          padding: '20px',
          borderRadius: '12px',
          border: '1px solid #E8F4FD',
          boxShadow: '0 2px 8px rgba(52, 152, 219, 0.1)',
          height: '400px',
          marginBottom: '20px'
        }}>
          <h3 style={{ 
            color: '#2C3E50', 
            marginBottom: '16px',
            fontSize: '16px'
          }}>
            📍 {districtInfo.name} Location Map
          </h3>
          <div style={{ height: '320px', borderRadius: '8px', overflow: 'hidden' }}>
            <Map
              {...viewState}
              onMove={evt => setViewState(evt.viewState)}
              style={{ width: '100%', height: '100%' }}
              mapStyle="mapbox://styles/mapbox/light-v10"
              mapboxAccessToken={MAPBOX_TOKEN}
            >
              <Source
                id="district-boundaries"
                type="geojson"
                data={{
                  type: "FeatureCollection",
                  features: mapFeatures
                }}
              >
                <Layer
                  id="district-fill"
                  type="fill"
                  paint={{
                    'fill-color': '#3498DB',
                    'fill-opacity': 0.6
                  }}
                />
                <Layer
                  id="district-stroke"
                  type="line"
                  paint={{
                    'line-color': '#2980B9',
                    'line-width': 2
                  }}
                />
              </Source>
            </Map>
          </div>
        </div>
      )}

      {/* Detailed Indicators Table - Show in both chart and map modes when not in modal, or only in map mode when in modal */}
      {isIndividualDistrict && (!isModal || !chartOnly) && (
        <div style={{
          background: '#ffffff',
          padding: '20px',
          borderRadius: '12px',
          border: '1px solid #E8F4FD',
          boxShadow: '0 2px 8px rgba(52, 152, 219, 0.1)'
        }}>
          <h3 style={{ 
            color: '#2C3E50', 
            marginBottom: '16px',
            fontSize: '16px'
          }}>
            📊 Detailed Indicator Analysis
          </h3>
          
          {districtInfo.sdgGoalsData.map(goal => (
            <div key={goal.sdg_goal} style={{ marginBottom: '24px' }}>
              <h4 style={{
                color: SDG_COLORS[goal.sdg_goal] || '#3498DB',
                marginBottom: '12px',
                padding: '8px 12px',
                background: `${SDG_COLORS[goal.sdg_goal] || '#3498DB'}15`,
                borderRadius: '6px',
                fontSize: '14px'
              }}>
                SDG Goal {goal.sdg_goal} ({goal.total_indicators} indicators)
              </h4>

              <div style={{
                overflowX: 'auto',
                borderRadius: '8px',
                border: '1px solid #E8F4FD'
              }}>
                <table style={{
                  width: '100%',
                  borderCollapse: 'collapse',
                  fontSize: '13px'
                }}>
                  <thead>
                    <tr style={{ background: '#F8F9FA' }}>
                      <th style={{ padding: '12px 8px', textAlign: 'left', color: '#2C3E50' }}>Indicator</th>
                      <th style={{ padding: '12px 8px', textAlign: 'center', color: '#2C3E50' }}>NFHS-4</th>
                      <th style={{ padding: '12px 8px', textAlign: 'center', color: '#2C3E50' }}>NFHS-5</th>
                      <th style={{ padding: '12px 8px', textAlign: 'center', color: '#2C3E50' }}>Change</th>
                      <th style={{ padding: '12px 8px', textAlign: 'center', color: '#2C3E50' }}>Trend</th>
                    </tr>
                  </thead>
                  <tbody>
                    {goal.indicators.map((indicator, index) => (
                      <tr key={index} style={{
                        borderBottom: '1px solid #F8F9FA',
                        background: index % 2 === 0 ? '#ffffff' : '#FAFBFC'
                      }}>
                        <td style={{ 
                          padding: '12px 8px',
                          maxWidth: '200px',
                          fontSize: '12px',
                          lineHeight: '1.3'
                        }}>
                          <div style={{ fontWeight: 'bold', color: '#2C3E50' }}>
                            {indicator.indicator_name}
                          </div>
                          <div style={{ color: '#7F8C8D', fontSize: '11px' }}>
                            {indicator.indicator_full_name}
                          </div>
                        </td>
                        <td style={{ 
                          padding: '12px 8px', 
                          textAlign: 'center',
                          color: '#3498DB',
                          fontWeight: 'bold'
                        }}>
                          {indicator.nfhs_4_value?.toFixed(2) || 'N/A'}
                        </td>
                        <td style={{ 
                          padding: '12px 8px', 
                          textAlign: 'center',
                          color: '#2ECC71',
                          fontWeight: 'bold'
                        }}>
                          {indicator.nfhs_5_value?.toFixed(2) || 'N/A'}
                        </td>
                        <td style={{ 
                          padding: '12px 8px', 
                          textAlign: 'center',
                          color: indicator.change_interpretation?.is_improvement ? '#2ECC71' : 
                                indicator.change_interpretation?.is_improvement === false ? '#E74C3C' : '#95A5A6',
                          fontWeight: 'bold'
                        }}>
                          {indicator.annual_change?.toFixed(2) || 'N/A'}
                        </td>
                        <td style={{ 
                          padding: '12px 8px', 
                          textAlign: 'center',
                          fontSize: '16px'
                        }}>
                          {decodeUnicode(indicator.change_interpretation?.trend_icon) || '→'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Detailed Indicators Table for Best/Worst Overall SDG - use same format as individual district */}
      {isBestWorstDistrict && districtInfo.isOverallSDG && districtInfo.sdgGoalsData && (!isModal || !chartOnly) && (
        <div style={{
          background: '#ffffff',
          padding: '20px',
          borderRadius: '12px',
          border: '1px solid #E8F4FD',
          boxShadow: '0 2px 8px rgba(52, 152, 219, 0.1)'
        }}>
          <h3 style={{ 
            color: '#2C3E50', 
            marginBottom: '16px',
            fontSize: '16px'
          }}>
            📊 SDG {districtInfo.sdgGoal} Indicator Breakdown - {districtInfo.performanceType} Performer
          </h3>
          
          {districtInfo.sdgGoalsData.map(goal => (
            <div key={goal.sdg_goal} style={{ marginBottom: '24px' }}>
              <h4 style={{
                color: SDG_COLORS[goal.sdg_goal] || '#3498DB',
                marginBottom: '12px',
                padding: '8px 12px',
                background: `${SDG_COLORS[goal.sdg_goal] || '#3498DB'}15`,
                borderRadius: '6px',
                fontSize: '14px'
              }}>
                SDG Goal {goal.sdg_goal} ({goal.total_indicators} indicators) - {districtInfo.performanceType} Performer
              </h4>

              <div style={{
                overflowX: 'auto',
                borderRadius: '8px',
                border: '1px solid #E8F4FD'
              }}>
                <table style={{
                  width: '100%',
                  borderCollapse: 'collapse',
                  fontSize: '13px'
                }}>
                  <thead>
                    <tr style={{ background: '#F8F9FA' }}>
                      <th style={{ padding: '12px 8px', textAlign: 'left', color: '#2C3E50' }}>Indicator</th>
                      <th style={{ padding: '12px 8px', textAlign: 'center', color: '#2C3E50' }}>NFHS-4</th>
                      <th style={{ padding: '12px 8px', textAlign: 'center', color: '#2C3E50' }}>NFHS-5</th>
                      <th style={{ padding: '12px 8px', textAlign: 'center', color: '#2C3E50' }}>Change</th>
                      <th style={{ padding: '12px 8px', textAlign: 'center', color: '#2C3E50' }}>Trend</th>
                    </tr>
                  </thead>
                  <tbody>
                    {goal.indicators.map((indicator, index) => (
                      <tr key={index} style={{
                        borderBottom: '1px solid #F8F9FA',
                        background: index % 2 === 0 ? '#ffffff' : '#FAFBFC'
                      }}>
                        <td style={{ 
                          padding: '12px 8px',
                          maxWidth: '200px',
                          fontSize: '12px',
                          lineHeight: '1.3'
                        }}>
                          <div style={{ fontWeight: 'bold', color: '#2C3E50' }}>
                            {indicator.indicator_name}
                          </div>
                          <div style={{ color: '#7F8C8D', fontSize: '11px' }}>
                            {indicator.indicator_full_name}
                          </div>
                        </td>
                        <td style={{ 
                          padding: '12px 8px', 
                          textAlign: 'center',
                          color: '#3498DB',
                          fontWeight: 'bold'
                        }}>
                          {indicator.nfhs_4_value?.toFixed(2) || 'N/A'}
                        </td>
                        <td style={{ 
                          padding: '12px 8px', 
                          textAlign: 'center',
                          color: '#2ECC71',
                          fontWeight: 'bold'
                        }}>
                          {indicator.nfhs_5_value?.toFixed(2) || 'N/A'}
                        </td>
                        <td style={{ 
                          padding: '12px 8px', 
                          textAlign: 'center',
                          color: indicator.change_interpretation?.is_improvement ? '#2ECC71' : 
                                indicator.change_interpretation?.is_improvement === false ? '#E74C3C' : '#95A5A6',
                          fontWeight: 'bold'
                        }}>
                          {indicator.annual_change?.toFixed(2) || 'N/A'}
                        </td>
                        <td style={{ 
                          padding: '12px 8px', 
                          textAlign: 'center',
                          fontSize: '16px'
                        }}>
                          {decodeUnicode(indicator.change_interpretation?.trend_icon) || '→'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}

          {/* Summary Statistics */}
          <div style={{
            marginTop: '20px',
            padding: '16px',
            background: '#F8F9FA',
            borderRadius: '8px',
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
            gap: '16px'
          }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '20px', fontWeight: 'bold', color: '#138D75' }}>
                {districtInfo.summary.improving_indicators}
              </div>
              <div style={{ fontSize: '12px', color: '#5D6D7E' }}>Improving Indicators</div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '20px', fontWeight: 'bold', color: '#C0392B' }}>
                {districtInfo.summary.deteriorating_indicators}
              </div>
              <div style={{ fontSize: '12px', color: '#5D6D7E' }}>Deteriorating Indicators</div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '20px', fontWeight: 'bold', color: '#2980B9' }}>
                {districtInfo.summary.improvement_rate.toFixed(1)}%
              </div>
              <div style={{ fontSize: '12px', color: '#5D6D7E' }}>Improvement Rate</div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '20px', fontWeight: 'bold', color: '#8E44AD' }}>
                {districtInfo.performancePercentile.toFixed(1)}%
              </div>
              <div style={{ fontSize: '12px', color: '#5D6D7E' }}>Performance Percentile</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
} 