import React, { useState, useMemo } from 'react';
import { Bar, Scatter, Line, Doughnut } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  Tooltip,
  Legend,
  ArcElement,
} from 'chart.js';
import Map, { Source, Layer } from 'react-map-gl';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  Tooltip,
  Legend,
  ArcElement
);

const MAPBOX_TOKEN = "pk.eyJ1Ijoic2FuZGVzaDMzOSIsImEiOiJjbThqazJuaTYwaTlwMmtwdzU4NzUwN3YwIn0.Kc6gPcC0Jf2rSJN4ieeimA";

const CrossSDGAnalysis = ({ data, boundary = [], onBack, chartOnly = false, isModal = false }) => {
  // State management
  const [viewMode, setViewMode] = useState(chartOnly ? 'overview' : isModal ? 'map' : 'overview');
  const [selectedAnalysisType, setSelectedAnalysisType] = useState('correlation');
  const [selectedGoals, setSelectedGoals] = useState([1, 3, 4]);
  const [selectedDistrict, setSelectedDistrict] = useState(null);
  const [viewState, setViewState] = useState({
    longitude: 77.1025,
    latitude: 28.7041,
    zoom: 4.5
  });

  // Extract data based on structure - FIXED
  const analysisData = useMemo(() => {
    if (!data) return null;
    
    console.log('Raw data received:', data);
    
    // Handle the actual API response structure from backend
    // The structure is: { response, data: [{ function, arguments, result }] }
    if (data.data && Array.isArray(data.data) && data.data[0]?.result) {
      console.log('Using API response structure:', data.data[0].result);
      return data.data[0].result;
    }
    
    // Handle wrapped response structure (legacy)
    if (Array.isArray(data) && data[0]?.result) {
      console.log('Using wrapped result:', data[0].result);
      return data[0].result;
    }
    
    // Handle direct data structure
    if (Array.isArray(data)) {
      console.log('Using array data:', data[0]);
      return data[0];
    }
    
    console.log('Using direct data:', data);
    return data;
  }, [data]);

  const analysisResults = useMemo(() => {
    const results = analysisData?.data || [];
    console.log('Analysis Results:', results);
    return results;
  }, [analysisData]);

  const correlationData = useMemo(() => {
    const correlations = analysisData?.correlations || {};
    console.log('Correlation Data:', correlations);
    return correlations;
  }, [analysisData]);

  const boundaryData = useMemo(() => {
    // First try to get boundary data from the API response
    let boundaries = analysisData?.boundary_data || [];
    
    // If no boundary data from analysis, check the API response boundary field
    if (boundaries.length === 0 && data?.boundary && Array.isArray(data.boundary)) {
      boundaries = data.boundary;
    }
    
    // Fall back to passed boundary prop
    if (boundaries.length === 0) {
      boundaries = boundary || [];
    }
    
    console.log('Boundary Data:', boundaries.length, 'features');
    return boundaries;
  }, [analysisData, boundary, data]);

  const sdgGoals = useMemo(() => {
    const goals = analysisData?.sdg_goals || [1, 3, 4];
    console.log('SDG Goals:', goals);
    return goals;
  }, [analysisData]);

  const analysisType = useMemo(() => {
    const type = analysisData?.query_type || 'correlation';
    console.log('Analysis Type:', type);
    return type;
  }, [analysisData]);

  // Get analysis type label - moved here to avoid hoisting issues
  const getAnalysisTypeLabel = (type) => {
    const labels = {
      'correlation': 'Correlation Analysis',
      'multi_goal_performance': 'Multi-Goal Performance',
      'goal_synergies': 'Goal Synergies',
      'best_worst_performers': 'Best vs Worst Performers'
    };
    return labels[type] || type;
  };

  // Debug logging
  console.log('Cross SDG Analysis Data:', {
    rawData: data,
    analysisData,
    analysisResults: analysisResults.length,
    correlationData,
    boundaryDataCount: boundaryData.length,
    sdgGoals,
    analysisType
  });

  // Generate summary statistics
  const summary = useMemo(() => {
    if (!analysisResults || analysisResults.length === 0) {
      return {
        total_districts: 0,
        avg_performance: 0,
        total_states: 0,
        analysis_coverage: 0
      };
    }

    const totalDistricts = analysisResults.length;
    const uniqueStates = [...new Set(analysisResults.map(item => item.state))].length;
    
    let avgPerformance = 0;
    if (analysisType === 'multi_goal_performance') {
      avgPerformance = analysisResults.reduce((sum, item) => sum + (item.overall_performance || 0), 0) / totalDistricts;
    } else if (analysisType === 'correlation') {
      const firstGoal = `sdg_${sdgGoals[0]}_score`;
      avgPerformance = analysisResults.reduce((sum, item) => sum + (item[firstGoal] || 0), 0) / totalDistricts;
    } else if (analysisType === 'best_worst_performers') {
      // Calculate average of combined_performance for best_worst_performers
      avgPerformance = analysisResults.reduce((sum, item) => sum + (parseFloat(item.combined_performance) || 0), 0) / totalDistricts;
    } else if (analysisType === 'goal_synergies') {
      // Calculate average of avg_performance for goal_synergies
      avgPerformance = analysisResults.reduce((sum, item) => sum + (parseFloat(item.avg_performance) || 0), 0) / totalDistricts;
    }
    
    console.log('Summary calculation:', {
      analysisType,
      totalDistricts,
      avgPerformance,
      sampleData: analysisResults[0]
    });

    return {
      total_districts: totalDistricts,
      avg_performance: avgPerformance,
      total_states: uniqueStates,
      analysis_coverage: sdgGoals.length,
      sdg_goals_analyzed: sdgGoals
    };
  }, [analysisResults, analysisType, sdgGoals]);

  // Prepare chart data based on analysis type - FIXED
  const chartData = useMemo(() => {
    if (!analysisResults || analysisResults.length === 0) {
      console.log('No analysis results for chart');
      return null;
    }

    console.log('Preparing chart data for type:', analysisType);
    
    try {

    if (analysisType === 'correlation') {
      // Scatter plot for correlation analysis
      const datasets = [];
      const colors = ['#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6'];
      
      for (let i = 0; i < sdgGoals.length - 1; i++) {
        for (let j = i + 1; j < sdgGoals.length; j++) {
          const goal1 = sdgGoals[i];
          const goal2 = sdgGoals[j];
          const goal1Key = `sdg_${goal1}_score`;
          const goal2Key = `sdg_${goal2}_score`;
          
          const scatterData = analysisResults
            .filter(item => 
              item && 
              item[goal1Key] != null && 
              item[goal2Key] != null &&
              item.district && 
              item.state
            )
            .map(item => ({
              x: parseFloat(item[goal1Key]) || 0,
              y: parseFloat(item[goal2Key]) || 0,
              district: item.district || 'Unknown',
              state: item.state || 'Unknown'
            }))
            .filter(point => point.x !== undefined && point.y !== undefined);

          if (scatterData.length > 0) {
            datasets.push({
              label: `SDG ${goal1} vs SDG ${goal2}`,
              data: scatterData,
              backgroundColor: colors[datasets.length % colors.length] + '80',
              borderColor: colors[datasets.length % colors.length],
              pointRadius: 4,
              pointHoverRadius: 6
            });
          }
        }
      }

      console.log('Correlation datasets:', datasets);
      return { datasets };
    }

    if (analysisType === 'multi_goal_performance') {
      const sortedDistricts = [...analysisResults]
        .filter(item => item && item.district && item.state && item.overall_performance != null)
        .sort((a, b) => (b.overall_performance || 0) - (a.overall_performance || 0))
        .slice(0, 15);
      
      console.log('Multi-goal performance data:', sortedDistricts);
      
      return {
        labels: sortedDistricts.map(item => `${item.district || 'Unknown'}, ${item.state || 'Unknown'}`),
        datasets: [
          {
            label: 'Overall Performance (%)',
            data: sortedDistricts.map(item => parseFloat(item.overall_performance) || 0),
            backgroundColor: 'rgba(59, 130, 246, 0.7)',
            borderColor: 'rgba(59, 130, 246, 1)',
            borderWidth: 1,
          }
        ]
      };
    }

    if (analysisType === 'best_worst_performers') {
      const bestPerformers = analysisResults.filter(item => 
        item && item.category === 'Best Performers' && item.district && item.state
      );
      const worstPerformers = analysisResults.filter(item => 
        item && item.category === 'Worst Performers' && item.district && item.state
      );
      
      console.log('Best performers:', bestPerformers);
      console.log('Worst performers:', worstPerformers);
      
      const allDistricts = [...bestPerformers, ...worstPerformers];
      
      return {
        labels: allDistricts.map(item => `${item.district || 'Unknown'}, ${item.state || 'Unknown'}`),
        datasets: [
          {
            label: '🎯 Combined Performance Score',
            data: allDistricts.map(item => parseFloat(item.combined_performance) || 0),
            backgroundColor: allDistricts.map((item, index) => {
              if (index < bestPerformers.length) {
                // Gradient green for best performers
                return 'linear-gradient(135deg, rgba(34, 197, 94, 0.8), rgba(16, 185, 129, 0.9))';
              } else {
                // Gradient red for worst performers  
                return 'linear-gradient(135deg, rgba(248, 113, 113, 0.8), rgba(239, 68, 68, 0.9))';
              }
            }),
            borderColor: allDistricts.map((item, index) => 
              index < bestPerformers.length ? '#059669' : '#dc2626'
            ),
            borderWidth: 2,
            borderRadius: 8,
            borderSkipped: false,
            hoverBackgroundColor: allDistricts.map((item, index) => 
              index < bestPerformers.length ? 'rgba(34, 197, 94, 1)' : 'rgba(248, 113, 113, 1)'
            ),
            hoverBorderColor: allDistricts.map((item, index) => 
              index < bestPerformers.length ? '#047857' : '#b91c1c'
            ),
            hoverBorderWidth: 3,
          }
        ]
      };
    }

    if (analysisType === 'goal_synergies') {
      const sortedDistricts = [...analysisResults]
        .filter(item => item && item.district && item.state && item.avg_performance != null)
        .sort((a, b) => (b.avg_performance || 0) - (a.avg_performance || 0))
        .slice(0, 15);
      
      return {
        labels: sortedDistricts.map(item => `${item.district || 'Unknown'}, ${item.state || 'Unknown'}`),
        datasets: [
          {
            label: 'Average Performance (%)',
            data: sortedDistricts.map(item => parseFloat(item.avg_performance) || 0),
            backgroundColor: 'rgba(139, 92, 246, 0.7)',
            borderColor: 'rgba(139, 92, 246, 1)',
            borderWidth: 1,
          },
          {
            label: 'Performance Gap',
            data: sortedDistricts.map(item => parseFloat(item.performance_gap) || 0),
            backgroundColor: 'rgba(245, 158, 11, 0.7)',
            borderColor: 'rgba(245, 158, 11, 1)',
            borderWidth: 1,
          }
        ]
      };
    }

    console.log('No matching analysis type, returning null');
    return null;
    
    } catch (error) {
      console.error('Error preparing chart data:', error);
      return null;
    }
  }, [analysisResults, analysisType, sdgGoals]);

  // Correlation matrix chart for correlation analysis
  const correlationChartData = useMemo(() => {
    if (analysisType !== 'correlation' || !correlationData) return null;

    try {
      const correlationValues = Object.values(correlationData).map(corr => corr?.correlation || 0);
      const correlationLabels = Object.keys(correlationData).map(key => 
        key.replace(/SDG_(\d+)_vs_SDG_(\d+)/, 'SDG $1 vs $2')
      );

    return {
      labels: correlationLabels,
      datasets: [
        {
          label: 'Correlation Coefficient',
          data: correlationValues,
          backgroundColor: correlationValues.map(val => 
            val > 0.5 ? 'rgba(16, 185, 129, 0.7)' :
            val > 0 ? 'rgba(59, 130, 246, 0.7)' :
            val > -0.5 ? 'rgba(245, 158, 11, 0.7)' : 'rgba(239, 68, 68, 0.7)'
          ),
          borderColor: correlationValues.map(val => 
            val > 0.5 ? 'rgba(16, 185, 129, 1)' :
            val > 0 ? 'rgba(59, 130, 246, 1)' :
            val > -0.5 ? 'rgba(245, 158, 11, 1)' : 'rgba(239, 68, 68, 1)'
          ),
          borderWidth: 1,
        }
      ]
    };
    
    } catch (error) {
      console.error('Error preparing correlation chart data:', error);
      return null;
    }
  }, [correlationData, analysisType]);

  // SDG goals distribution chart
  const goalsDistributionData = useMemo(() => {
    if (!sdgGoals || sdgGoals.length === 0) return null;

    const sdgNames = {
      1: 'No Poverty',
      2: 'Zero Hunger', 
      3: 'Good Health',
      4: 'Quality Education',
      5: 'Gender Equality',
      6: 'Clean Water',
      7: 'Clean Energy',
      8: 'Decent Work',
      9: 'Innovation',
      10: 'Reduced Inequalities',
      11: 'Sustainable Cities',
      12: 'Responsible Consumption',
      13: 'Climate Action',
      14: 'Life Below Water',
      15: 'Life on Land',
      16: 'Peace & Justice',
      17: 'Partnerships'
    };

    return {
      labels: sdgGoals.map(goal => `SDG ${goal}: ${sdgNames[goal] || 'Unknown'}`),
      datasets: [
        {
          data: sdgGoals.map(() => 1), // Equal distribution for visualization
          backgroundColor: [
            '#e53e3e', '#d69e2e', '#38a169', '#3182ce', '#805ad5',
            '#d53f8c', '#00b5d8', '#dd6b20', '#319795', '#553c9a'
          ].slice(0, sdgGoals.length),
          borderWidth: 2,
          borderColor: '#ffffff'
        }
      ]
    };
  }, [sdgGoals]);

  // Prepare map data - FIXED
  const mapFeatures = useMemo(() => {
    if (!boundaryData || boundaryData.length === 0 || !analysisResults || analysisResults.length === 0) {
      console.log('Missing boundary or analysis data for map');
      return [];
    }

    console.log('Preparing map features...');
    console.log('Boundary data count:', boundaryData.length);
    console.log('Analysis results count:', analysisResults.length);

    const features = boundaryData.map(boundary => {
      // Try multiple matching strategies
      const districtData = analysisResults.find(item => {
        const itemDistrict = (item.district || item.district_name || '').toLowerCase().trim();
        const boundaryDistrict = (boundary.district || boundary.properties?.district || boundary.properties?.DISTRICT || '').toLowerCase().trim();
        
        return itemDistrict === boundaryDistrict ||
               itemDistrict.includes(boundaryDistrict) ||
               boundaryDistrict.includes(itemDistrict);
      });

      let performanceScore = 0;
      let color = '#94a3b8'; // default gray
      let category = 'No Data';

      if (districtData) {
        if (analysisType === 'multi_goal_performance') {
          performanceScore = parseFloat(districtData.overall_performance) || 0;
          category = districtData.performance_category || 'Unknown';
        } else if (analysisType === 'correlation' && sdgGoals[0]) {
          performanceScore = parseFloat(districtData[`sdg_${sdgGoals[0]}_score`]) || 0;
          category = 'Correlation Data';
        } else if (analysisType === 'best_worst_performers') {
          performanceScore = parseFloat(districtData.combined_performance) || 0;
          category = districtData.category || 'Unknown';
        } else if (analysisType === 'goal_synergies') {
          performanceScore = parseFloat(districtData.avg_performance) || 0;
          category = districtData.synergy_pattern || 'Unknown';
        }

        // Color based on performance and category
        if (analysisType === 'best_worst_performers') {
          color = districtData.category === 'Best Performers' ? '#10b981' : '#ef4444';
        } else {
          if (performanceScore >= 75) color = '#10b981'; // green
          else if (performanceScore >= 50) color = '#3b82f6'; // blue  
          else if (performanceScore >= 25) color = '#f59e0b'; // yellow
          else if (performanceScore > 0) color = '#ef4444'; // red
          else color = '#94a3b8'; // gray for no data
        }
      }

      return {
        ...boundary,
        properties: {
          ...boundary.properties,
          district: boundary.district || boundary.properties?.district || boundary.properties?.DISTRICT,
          state: boundary.state || boundary.properties?.state || boundary.properties?.STATE,
          performanceScore,
          color,
          category,
          analysisData: districtData
        }
      };
    });

    const featuresWithData = features.filter(f => f.properties.analysisData);
    console.log('Map features with data:', featuresWithData.length);
    console.log('Sample feature:', features[0]?.properties);

    return features;
  }, [boundaryData, analysisResults, analysisType, sdgGoals]);

  const normalizedFeatures = useMemo(() => {
    return mapFeatures.map(feature => ({
      type: "Feature",
      properties: {
        ...feature.properties,
        color: feature.properties.color
      },
      geometry: feature.geometry || feature
    }));
  }, [mapFeatures]);

  // Enhanced Chart options with modern styling
  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    resizeDelay: 200,
    devicePixelRatio: 2,
    animation: {
      duration: isModal ? 1000 : 1800,
      easing: 'easeInOutQuart'
    },
    plugins: {
      legend: {
        position: 'top',
        labels: {
          font: {
            size: 13,
            weight: '600'
          },
          color: '#374151',
          padding: 20,
          usePointStyle: true,
          pointStyle: 'rectRounded'
        }
      },
      title: {
        display: true,
        text: getAnalysisTypeLabel(analysisType),
        font: {
          size: 18,
          weight: 'bold'
        },
        color: '#1f2937',
        padding: 25
      },
      tooltip: {
        backgroundColor: 'rgba(17, 24, 39, 0.95)',
        titleColor: '#ffffff',
        bodyColor: '#f3f4f6',
        borderColor: '#6366f1',
        borderWidth: 2,
        cornerRadius: 12,
        padding: 16,
        displayColors: true,
        titleFont: {
          size: 14,
          weight: 'bold'
        },
        bodyFont: {
          size: 13
        },
        callbacks: {
          title: function(context) {
            return context[0].label;
          },
          label: function(context) {
            return `Performance: ${context.parsed.y.toFixed(1)}%`;
          }
        }
      }
    },
    scales: {
      x: {
        grid: {
          color: 'rgba(156, 163, 175, 0.2)',
          drawBorder: false,
          lineWidth: 1
        },
        ticks: {
          color: '#6b7280',
          font: {
            size: 11,
            weight: '500'
          },
          maxRotation: 45,
          minRotation: 30
        }
      },
      y: {
        beginAtZero: true,
        grid: {
          color: 'rgba(156, 163, 175, 0.2)',
          drawBorder: false,
          lineWidth: 1
        },
        ticks: {
          color: '#6b7280',
          font: {
            size: 11,
            weight: '500'
          },
          callback: function(value) {
            return value + '%';
          }
        }
      }
    }
  };

  const scatterOptions = {
    responsive: true,
    maintainAspectRatio: false,
    resizeDelay: 200,
    devicePixelRatio: 2,
    animation: {
      duration: isModal ? 1000 : 2000,
      easing: 'easeInOutElastic'
    },
    plugins: {
      legend: {
        position: 'top',
        labels: {
          font: {
            size: 13,
            weight: '600'
          },
          color: '#374151',
          padding: 20,
          usePointStyle: true,
          pointStyle: 'circle'
        }
      },
      title: {
        display: true,
        text: '🔍 SDG Goals Correlation Matrix',
        font: {
          size: 18,
          weight: 'bold'
        },
        color: '#1f2937',
        padding: 25
      },
      tooltip: {
        backgroundColor: 'rgba(17, 24, 39, 0.95)',
        titleColor: '#ffffff',
        bodyColor: '#f3f4f6',
        borderColor: '#8b5cf6',
        borderWidth: 2,
        cornerRadius: 12,
        padding: 16,
        displayColors: true,
        titleFont: {
          size: 14,
          weight: 'bold'
        },
        bodyFont: {
          size: 13
        },
        callbacks: {
          title: function(context) {
            const point = context[0]?.raw;
            if (!point) return 'District Data';
            return `📍 ${point.district || 'Unknown'}, ${point.state || 'Unknown'}`;
          },
          label: function(context) {
            const point = context.raw;
            if (!point) return 'No data';
            
            const sdgLabels = sdgGoals || [1, 2]; // Fallback SDG goals
            return [
              `SDG ${sdgLabels[0] || 1}: ${(point.x || 0).toFixed(1)}%`,
              `SDG ${sdgLabels[1] || 2}: ${(point.y || 0).toFixed(1)}%`
            ];
          }
        }
      }
    },
    scales: {
      x: {
        beginAtZero: true,
        grid: {
          color: 'rgba(156, 163, 175, 0.2)',
          drawBorder: false,
          lineWidth: 1
        },
        ticks: {
          color: '#6b7280',
          font: {
            size: 11,
            weight: '500'
          }
        },
        title: {
          display: true,
          text: `📊 SDG ${sdgGoals[0]} Performance Score`,
          color: '#374151',
          font: {
            size: 13,
            weight: 'bold'
          },
          padding: 10
        }
      },
      y: {
        beginAtZero: true,
        grid: {
          color: 'rgba(156, 163, 175, 0.2)',
          drawBorder: false,
          lineWidth: 1
        },
        ticks: {
          color: '#6b7280',
          font: {
            size: 11,
            weight: '500'
          }
        },
        title: {
          display: true,
          text: `📈 SDG ${sdgGoals[1]} Performance Score`,
          color: '#374151',
          font: {
            size: 13,
            weight: 'bold'
          },
          padding: 10
        }
      }
    }
  };

  const correlationOptions = {
    responsive: true,
    maintainAspectRatio: false,
    animation: {
      duration: 2200,
      easing: 'easeInOutBounce'
    },
    plugins: {
      legend: {
        display: false
      },
      title: {
        display: true,
        text: '🔗 Correlation Strength Matrix',
        font: {
          size: 18,
          weight: 'bold'
        },
        color: '#1f2937',
        padding: 25
      },
      tooltip: {
        backgroundColor: 'rgba(17, 24, 39, 0.95)',
        titleColor: '#ffffff',
        bodyColor: '#f3f4f6',
        borderColor: '#f59e0b',
        borderWidth: 2,
        cornerRadius: 12,
        padding: 16,
        titleFont: {
          size: 14,
          weight: 'bold'
        },
        bodyFont: {
          size: 13
        },
        callbacks: {
          title: function(context) {
            return '📊 ' + (context[0]?.label || 'Correlation Data');
          },
          label: function(context) {
            const value = context.parsed?.y || 0;
            let strength = '';
            let emoji = '';
            if (Math.abs(value) >= 0.7) { strength = 'Strong'; emoji = '💪'; }
            else if (Math.abs(value) >= 0.5) { strength = 'Moderate'; emoji = '👍'; }
            else if (Math.abs(value) >= 0.3) { strength = 'Weak'; emoji = '🤏'; }
            else { strength = 'Very Weak'; emoji = '😴'; }
            
            return `${emoji} Correlation: ${value.toFixed(3)} (${strength})`;
          }
        }
      }
    },
    scales: {
      x: {
        grid: {
          color: 'rgba(156, 163, 175, 0.2)',
          drawBorder: false,
          lineWidth: 1
        },
        ticks: {
          color: '#6b7280',
          font: {
            size: 11,
            weight: '500'
          },
          maxRotation: 45
        }
      },
      y: {
        min: -1,
        max: 1,
        grid: {
          color: 'rgba(156, 163, 175, 0.2)',
          drawBorder: false,
          lineWidth: 1
        },
        ticks: {
          color: '#6b7280',
          font: {
            size: 11,
            weight: '500'
          },
          callback: function(value) {
            return value.toFixed(1);
          }
        },
        title: {
          display: true,
          text: '📈 Correlation Coefficient',
          color: '#374151',
          font: {
            size: 13,
            weight: 'bold'
          },
          padding: 10
        }
      }
    }
  };

  // Handle district click on map
  const handleDistrictClick = (event) => {
    const feature = event.features?.[0];
    if (feature?.properties) {
      setSelectedDistrict({
        district: feature.properties.district,
        state: feature.properties.state,
        performanceScore: feature.properties.performanceScore,
        analysisData: feature.properties.analysisData
      });
    }
  };

  // Function moved earlier to avoid hoisting issues

  // Performance color helper
  const getPerformanceColor = (score) => {
    if (score >= 75) return 'text-green-600';
    if (score >= 50) return 'text-blue-600';
    if (score >= 25) return 'text-yellow-600';
    return 'text-red-600';
  };

  if (!analysisData) {
    return (
      <div className="bg-white rounded-lg shadow-md p-6">
        <div className="text-center">
          <h2 className="text-xl font-bold text-gray-800 mb-4">Cross-SDG Analysis</h2>
          <p className="text-gray-600">No cross-SDG analysis data available</p>
          {onBack && (
            <button
              onClick={onBack}
              className="mt-4 px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
            >
              ← Back
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg shadow-md p-6">
      {/* Back button */}
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
                🎯 Analysis Type:
              </label>
              <select
                value={analysisType}
                disabled={true} // Read-only since it comes from data
                style={{
                  width: '100%',
                  padding: '12px 16px',
                  border: '2px solid #d1d5db',
                  borderRadius: '12px',
                  fontSize: '14px',
                  fontWeight: '500',
                  color: '#374151',
                  background: 'linear-gradient(135deg, #f9fafb, #f3f4f6)',
                  cursor: 'not-allowed'
                }}
              >
                <option value="correlation">📊 Correlation Analysis</option>
                <option value="multi_goal_performance">🎯 Multi-Goal Performance</option>
                <option value="goal_synergies">🔗 Goal Synergies</option>
                <option value="best_worst_performers">⚖️ Best vs Worst</option>
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
                onChange={(e) => setViewMode(e.target.value)}
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
              >
                <option value="overview">📋 Overview</option>
                <option value="detailed">📊 Detailed Analysis</option>
                <option value="correlations">🔍 Correlations</option>
                <option value="map">🗺️ Geographic Map</option>
              </select>
            </div>
          </div>
        </div>
      )}

      {/* Main Content based on View Mode */}
      {viewMode === 'overview' && (
        <div className="space-y-6">
          {/* Title and Summary */}
          <div className="text-center">
            <h2 className="text-2xl font-bold text-gray-800 mb-2">
              Cross-SDG Analysis: {getAnalysisTypeLabel(analysisType)}
            </h2>
            <p className="text-gray-600">
              Analysis across SDG Goals {sdgGoals.join(', ')} • {summary.total_districts} districts • {summary.total_states} states
            </p>
          </div>

          {/* Enhanced Summary Cards */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
            <div style={{
              background: 'linear-gradient(135deg, #dbeafe, #bfdbfe)',
              padding: '18px',
              borderRadius: '14px',
              boxShadow: '0 8px 20px -5px rgba(59, 130, 246, 0.3)',
              border: '2px solid rgba(59, 130, 246, 0.2)',
              minHeight: '140px',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              transition: 'all 0.3s ease'
            }}
            onMouseEnter={(e) => e.target.style.transform = 'translateY(-3px)'}
            onMouseLeave={(e) => e.target.style.transform = 'translateY(0px)'}
            >
              <div className="flex items-center justify-between mb-3">
                <span style={{
                  fontSize: '32px',
                  filter: 'drop-shadow(0 2px 4px rgba(59, 130, 246, 0.3))',
                  animation: 'pulse 3s infinite'
                }}>🏘️</span>
                <span style={{
                  color: '#1e40af',
                  fontSize: '10px',
                  fontWeight: '800',
                  padding: '4px 8px',
                  background: 'linear-gradient(135deg, #bfdbfe, #93c5fd)',
                  borderRadius: '12px',
                  border: '1px solid rgba(59, 130, 246, 0.3)',
                  fontFamily: '"Inter", "Segoe UI", sans-serif',
                  letterSpacing: '0.05em'
                }}>TOTAL</span>
              </div>
              <div>
                <h3 style={{
                  fontSize: '11px',
                  fontWeight: '800',
                  color: '#1e3a8a',
                  textTransform: 'uppercase',
                  letterSpacing: '0.1em',
                  marginBottom: '6px',
                  fontFamily: '"Inter", "Segoe UI", sans-serif',
                  textShadow: '0 1px 2px rgba(59, 130, 246, 0.2)'
                }}>Districts Analyzed</h3>
                <p style={{
                  fontSize: '30px',
                  fontWeight: '900',
                  color: '#1d4ed8',
                  marginBottom: '4px',
                  fontFamily: '"Inter", "Segoe UI", sans-serif',
                  textShadow: '0 2px 4px rgba(59, 130, 246, 0.3)',
                  letterSpacing: '-0.02em',
                  lineHeight: '1'
                }}>{summary.total_districts}</p>
                <p style={{
                  fontSize: '9px',
                  color: '#2563eb',
                  margin: '0',
                  fontFamily: '"Inter", "Segoe UI", sans-serif',
                  fontWeight: '600',
                  letterSpacing: '0.03em'
                }}>Comprehensive coverage</p>
              </div>
            </div>
            
            <div style={{
              background: 'linear-gradient(135deg, #dcfce7, #bbf7d0)',
              padding: '18px',
              borderRadius: '14px',
              boxShadow: '0 8px 20px -5px rgba(34, 197, 94, 0.3)',
              border: '2px solid rgba(34, 197, 94, 0.2)',
              minHeight: '140px',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              transition: 'all 0.3s ease'
            }}
            onMouseEnter={(e) => e.target.style.transform = 'translateY(-3px)'}
            onMouseLeave={(e) => e.target.style.transform = 'translateY(0px)'}
            >
              <div className="flex items-center justify-between mb-3">
                <span style={{
                  fontSize: '32px',
                  filter: 'drop-shadow(0 2px 4px rgba(34, 197, 94, 0.3))',
                  animation: 'bounce 3s infinite'
                }}>📊</span>
                <span style={{
                  color: '#15803d',
                  fontSize: '10px',
                  fontWeight: '800',
                  padding: '4px 8px',
                  background: 'linear-gradient(135deg, #bbf7d0, #86efac)',
                  borderRadius: '12px',
                  border: '1px solid rgba(34, 197, 94, 0.3)',
                  fontFamily: '"Inter", "Segoe UI", sans-serif',
                  letterSpacing: '0.05em'
                }}>AVG</span>
              </div>
              <div>
                <h3 style={{
                  fontSize: '11px',
                  fontWeight: '800',
                  color: '#14532d',
                  textTransform: 'uppercase',
                  letterSpacing: '0.1em',
                  marginBottom: '6px',
                  fontFamily: '"Inter", "Segoe UI", sans-serif',
                  textShadow: '0 1px 2px rgba(34, 197, 94, 0.2)'
                }}>Performance</h3>
                <p style={{
                  fontSize: '30px',
                  fontWeight: '900',
                  color: '#16a34a',
                  marginBottom: '4px',
                  fontFamily: '"Inter", "Segoe UI", sans-serif',
                  textShadow: '0 2px 4px rgba(34, 197, 94, 0.3)',
                  letterSpacing: '-0.02em',
                  lineHeight: '1'
                }}>{summary.avg_performance.toFixed(1)}%</p>
                <p style={{
                  fontSize: '9px',
                  color: '#15803d',
                  margin: '0',
                  fontFamily: '"Inter", "Segoe UI", sans-serif',
                  fontWeight: '600',
                  letterSpacing: '0.03em'
                }}>Cross-SDG average</p>
              </div>
            </div>
            
            <div style={{
              background: 'linear-gradient(135deg, #f3e8ff, #e9d5ff)',
              padding: '18px',
              borderRadius: '14px',
              boxShadow: '0 8px 20px -5px rgba(139, 92, 246, 0.3)',
              border: '2px solid rgba(139, 92, 246, 0.2)',
              minHeight: '140px',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              transition: 'all 0.3s ease'
            }}
            onMouseEnter={(e) => e.target.style.transform = 'translateY(-3px)'}
            onMouseLeave={(e) => e.target.style.transform = 'translateY(0px)'}
            >
              <div className="flex items-center justify-between mb-3">
                <span style={{
                  fontSize: '32px',
                  filter: 'drop-shadow(0 2px 4px rgba(139, 92, 246, 0.3))',
                  animation: 'pulse 2.5s infinite'
                }}>🎯</span>
                <span style={{
                  color: '#7c2d12',
                  fontSize: '10px',
                  fontWeight: '800',
                  padding: '4px 8px',
                  background: 'linear-gradient(135deg, #e9d5ff, #d8b4fe)',
                  borderRadius: '12px',
                  border: '1px solid rgba(139, 92, 246, 0.3)',
                  fontFamily: '"Inter", "Segoe UI", sans-serif',
                  letterSpacing: '0.05em'
                }}>GOALS</span>
              </div>
              <div>
                <h3 style={{
                  fontSize: '11px',
                  fontWeight: '800',
                  color: '#581c87',
                  textTransform: 'uppercase',
                  letterSpacing: '0.1em',
                  marginBottom: '6px',
                  fontFamily: '"Inter", "Segoe UI", sans-serif',
                  textShadow: '0 1px 2px rgba(139, 92, 246, 0.2)'
                }}>SDG Goals</h3>
                <p style={{
                  fontSize: '30px',
                  fontWeight: '900',
                  color: '#7c3aed',
                  marginBottom: '4px',
                  fontFamily: '"Inter", "Segoe UI", sans-serif',
                  textShadow: '0 2px 4px rgba(139, 92, 246, 0.3)',
                  letterSpacing: '-0.02em',
                  lineHeight: '1'
                }}>{summary.analysis_coverage}</p>
                <p style={{
                  fontSize: '9px',
                  color: '#7c2d12',
                  margin: '0',
                  fontFamily: '"Inter", "Segoe UI", sans-serif',
                  fontWeight: '600',
                  letterSpacing: '0.03em'
                }}>Analyzed together</p>
              </div>
            </div>
            
            <div style={{
              background: 'linear-gradient(135deg, #fed7aa, #fdba74)',
              padding: '18px',
              borderRadius: '14px',
              boxShadow: '0 8px 20px -5px rgba(249, 115, 22, 0.3)',
              border: '2px solid rgba(249, 115, 22, 0.2)',
              minHeight: '140px',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              transition: 'all 0.3s ease'
            }}
            onMouseEnter={(e) => e.target.style.transform = 'translateY(-3px)'}
            onMouseLeave={(e) => e.target.style.transform = 'translateY(0px)'}
            >
              <div className="flex items-center justify-between mb-3">
                <span style={{
                  fontSize: '32px',
                  filter: 'drop-shadow(0 2px 4px rgba(249, 115, 22, 0.3))',
                  animation: 'bounce 2s infinite'
                }}>🗺️</span>
                <span style={{
                  color: '#9a3412',
                  fontSize: '10px',
                  fontWeight: '800',
                  padding: '4px 8px',
                  background: 'linear-gradient(135deg, #fdba74, #fb923c)',
                  borderRadius: '12px',
                  border: '1px solid rgba(249, 115, 22, 0.3)',
                  fontFamily: '"Inter", "Segoe UI", sans-serif',
                  letterSpacing: '0.05em'
                }}>STATES</span>
              </div>
              <div>
                <h3 style={{
                  fontSize: '11px',
                  fontWeight: '800',
                  color: '#9a3412',
                  textTransform: 'uppercase',
                  letterSpacing: '0.1em',
                  marginBottom: '6px',
                  fontFamily: '"Inter", "Segoe UI", sans-serif',
                  textShadow: '0 1px 2px rgba(249, 115, 22, 0.2)'
                }}>States Covered</h3>
                <p style={{
                  fontSize: '30px',
                  fontWeight: '900',
                  color: '#ea580c',
                  marginBottom: '4px',
                  fontFamily: '"Inter", "Segoe UI", sans-serif',
                  textShadow: '0 2px 4px rgba(249, 115, 22, 0.3)',
                  letterSpacing: '-0.02em',
                  lineHeight: '1'
                }}>{summary.total_states}</p>
                <p style={{
                  fontSize: '9px',
                  color: '#c2410c',
                  margin: '0',
                  fontFamily: '"Inter", "Segoe UI", sans-serif',
                  fontWeight: '600',
                  letterSpacing: '0.03em'
                }}>Geographic spread</p>
              </div>
            </div>
          </div>

          {/* Enhanced Charts Grid */}
          <div className={`grid grid-cols-1 ${isModal ? 'gap-4' : 'lg:grid-cols-2 xl:grid-cols-3 gap-8'}`}>
            {/* Main Analysis Chart */}
            <div style={{
              background: 'linear-gradient(135deg, #ffffff, #f8fafc)',
              padding: isModal ? '16px' : '24px',
              borderRadius: '20px',
              boxShadow: '0 20px 40px -10px rgba(0, 0, 0, 0.15)',
              border: '2px solid rgba(139, 92, 246, 0.1)',
              height: isModal ? '500px' : '450px',
              minHeight: isModal ? '400px' : '350px',
              position: 'relative',
              overflow: 'hidden'
            }}>
              <div style={{
                position: 'absolute',
                top: '0',
                left: '0',
                right: '0',
                height: '4px',
                background: 'linear-gradient(90deg, #6366f1, #8b5cf6, #d946ef)',
                borderRadius: '20px 20px 0 0'
              }} />
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold text-gray-800 flex items-center">
                  <span className="text-2xl mr-2">📈</span>
                  {getAnalysisTypeLabel(analysisType)}
                </h3>
                <div className="px-3 py-1 bg-gradient-to-r from-indigo-100 to-purple-100 rounded-full">
                  <span className="text-xs font-bold text-indigo-700">Live Data</span>
                </div>
              </div>
              <div style={{ height: isModal ? 'calc(100% - 50px)' : 'calc(100% - 60px)' }}>
                {chartData && chartData.datasets && chartData.datasets.length > 0 ? (
                  analysisType === 'correlation' ? (
                    <Scatter data={chartData} options={scatterOptions} />
                  ) : (
                    <Bar data={chartData} options={chartOptions} />
                  )
                ) : (
                  <div className="flex items-center justify-center h-full" style={{
                    background: 'linear-gradient(135deg, #f1f5f9, #e2e8f0)',
                    borderRadius: '12px',
                    border: '2px dashed #cbd5e1'
                  }}>
                    <div className="text-center">
                      <span className="text-4xl mb-2 block">📊</span>
                      <p className="text-gray-600 font-semibold mb-2">No chart data available</p>
                      <p className="text-xs text-gray-500">
                        Analysis: {analysisType}<br/>
                        Results: {analysisResults.length} districts
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Correlation Matrix (for correlation analysis) */}
            {analysisType === 'correlation' && correlationChartData && correlationChartData.datasets && correlationChartData.datasets.length > 0 && (
              <div className="bg-white p-4 rounded-lg shadow-lg" style={{ height: isModal ? '500px' : '400px' }}>
                <h3 className="text-lg font-semibold text-gray-800 mb-4">Correlation Strength</h3>
                <div style={{ height: isModal ? 'calc(100% - 50px)' : 'calc(100% - 40px)' }}>
                  <Bar data={correlationChartData} options={correlationOptions} />
                </div>
              </div>
            )}

            {/* Enhanced Performance Summary Chart (for best_worst_performers) */}
            {analysisType === 'best_worst_performers' && analysisResults.length > 0 && (
              <div style={{
                background: 'linear-gradient(135deg, #ffffff, #f8fafc)',
                padding: '24px',
                borderRadius: '20px',
                boxShadow: '0 20px 40px -10px rgba(0, 0, 0, 0.15)',
                border: '2px solid rgba(34, 197, 94, 0.1)',
                height: '450px',
                position: 'relative',
                overflow: 'hidden'
              }}>
                <div style={{
                  position: 'absolute',
                  top: '0',
                  left: '0',
                  right: '0',
                  height: '4px',
                  background: 'linear-gradient(90deg, #22c55e, #10b981, #059669)',
                  borderRadius: '20px 20px 0 0'
                }} />
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-bold text-gray-800 flex items-center">
                    <span className="text-2xl mr-2">⚖️</span>
                    Performance Summary
                  </h3>
                  <div className="px-3 py-1 bg-gradient-to-r from-green-100 to-red-100 rounded-full">
                    <span className="text-xs font-bold text-gray-700">Best vs Worst</span>
                  </div>
                </div>
                <div style={{ height: 'calc(100% - 60px)', minHeight: '300px' }}>
                  <div style={{ 
                    display: 'grid', 
                    gridTemplateColumns: '1fr 1fr', 
                    gap: '16px', 
                    height: '100%',
                    alignItems: 'stretch'
                  }}>
                    <div style={{
                      background: 'linear-gradient(135deg, #dcfce7, #bbf7d0)',
                      padding: '16px',
                      borderRadius: '12px',
                      border: '2px solid rgba(34, 197, 94, 0.3)',
                      boxShadow: '0 4px 12px -2px rgba(34, 197, 94, 0.3)',
                      display: 'flex',
                      flexDirection: 'column',
                      justifyContent: 'space-between',
                      textAlign: 'center',
                      minHeight: '180px',
                      transition: 'all 0.3s ease'
                    }}
                    onMouseEnter={(e) => e.target.style.transform = 'translateY(-2px)'}
                    onMouseLeave={(e) => e.target.style.transform = 'translateY(0px)'}
                    >
                      <div>
                        <span className="text-4xl mb-2 block" style={{ 
                          filter: 'drop-shadow(0 2px 4px rgba(34, 197, 94, 0.3))',
                          animation: 'bounce 2s infinite'
                        }}>🏆</span>
                        <h4 style={{
                          fontSize: '11px',
                          fontWeight: '800',
                          color: '#064e3b',
                          textTransform: 'uppercase',
                          letterSpacing: '0.1em',
                          marginBottom: '8px',
                          fontFamily: '"Inter", "Segoe UI", sans-serif',
                          textShadow: '0 1px 2px rgba(34, 197, 94, 0.2)'
                        }}>
                          Best Performers
                        </h4>
                      </div>
                      <div>
                        <p style={{
                          fontSize: '28px',
                          fontWeight: '900',
                          color: '#047857',
                          marginBottom: '8px',
                          fontFamily: '"Inter", "Segoe UI", sans-serif',
                          textShadow: '0 2px 4px rgba(34, 197, 94, 0.3)',
                          letterSpacing: '-0.02em'
                        }}>
                          {analysisResults.filter(d => d.category === 'Best Performers').length}
                        </p>
                        <div style={{
                          background: 'linear-gradient(135deg, #bbf7d0, #a7f3d0)',
                          borderRadius: '20px',
                          padding: '6px 12px',
                          margin: '0 auto',
                          display: 'inline-block',
                          border: '1px solid rgba(34, 197, 94, 0.3)',
                          boxShadow: '0 2px 8px rgba(34, 197, 94, 0.2)'
                        }}>
                          <p style={{
                            fontSize: '10px',
                            fontWeight: '700',
                            color: '#065f46',
                            margin: '0',
                            fontFamily: '"Inter", "Segoe UI", sans-serif',
                            letterSpacing: '0.05em'
                          }}>
                            AVG: {(analysisResults.filter(d => d.category === 'Best Performers')
                              .reduce((sum, d) => sum + (parseFloat(d.combined_performance) || 0), 0) / 
                              Math.max(1, analysisResults.filter(d => d.category === 'Best Performers').length)).toFixed(1)}%
                          </p>
                        </div>
                      </div>
                    </div>
                    <div style={{
                      background: 'linear-gradient(135deg, #fecaca, #fca5a5)',
                      padding: '16px',
                      borderRadius: '12px',
                      border: '2px solid rgba(239, 68, 68, 0.3)',
                      boxShadow: '0 4px 12px -2px rgba(239, 68, 68, 0.3)',
                      display: 'flex',
                      flexDirection: 'column',
                      justifyContent: 'space-between',
                      textAlign: 'center',
                      minHeight: '180px',
                      transition: 'all 0.3s ease'
                    }}
                    onMouseEnter={(e) => e.target.style.transform = 'translateY(-2px)'}
                    onMouseLeave={(e) => e.target.style.transform = 'translateY(0px)'}
                    >
                      <div>
                        <span className="text-4xl mb-2 block" style={{ 
                          filter: 'drop-shadow(0 2px 4px rgba(239, 68, 68, 0.3))',
                          animation: 'pulse 2s infinite'
                        }}>📉</span>
                        <h4 style={{
                          fontSize: '11px',
                          fontWeight: '800',
                          color: '#7f1d1d',
                          textTransform: 'uppercase',
                          letterSpacing: '0.1em',
                          marginBottom: '8px',
                          fontFamily: '"Inter", "Segoe UI", sans-serif',
                          textShadow: '0 1px 2px rgba(239, 68, 68, 0.2)'
                        }}>
                          Worst Performers
                        </h4>
                      </div>
                      <div>
                        <p style={{
                          fontSize: '28px',
                          fontWeight: '900',
                          color: '#b91c1c',
                          marginBottom: '8px',
                          fontFamily: '"Inter", "Segoe UI", sans-serif',
                          textShadow: '0 2px 4px rgba(239, 68, 68, 0.3)',
                          letterSpacing: '-0.02em'
                        }}>
                          {analysisResults.filter(d => d.category === 'Worst Performers').length}
                        </p>
                        <div style={{
                          background: 'linear-gradient(135deg, #fca5a5, #f87171)',
                          borderRadius: '20px',
                          padding: '6px 12px',
                          margin: '0 auto',
                          display: 'inline-block',
                          border: '1px solid rgba(239, 68, 68, 0.3)',
                          boxShadow: '0 2px 8px rgba(239, 68, 68, 0.2)'
                        }}>
                          <p style={{
                            fontSize: '10px',
                            fontWeight: '700',
                            color: '#7f1d1d',
                            margin: '0',
                            fontFamily: '"Inter", "Segoe UI", sans-serif',
                            letterSpacing: '0.05em'
                          }}>
                            AVG: {(analysisResults.filter(d => d.category === 'Worst Performers')
                              .reduce((sum, d) => sum + (parseFloat(d.combined_performance) || 0), 0) / 
                              Math.max(1, analysisResults.filter(d => d.category === 'Worst Performers').length)).toFixed(1)}%
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Enhanced SDG Goals Distribution */}
            <div style={{
              background: 'linear-gradient(135deg, #ffffff, #f8fafc)',
              padding: '24px',
              borderRadius: '20px',
              boxShadow: '0 20px 40px -10px rgba(0, 0, 0, 0.15)',
              border: '2px solid rgba(245, 158, 11, 0.1)',
              height: '450px',
              position: 'relative',
              overflow: 'hidden'
            }}>
              <div style={{
                position: 'absolute',
                top: '0',
                left: '0',
                right: '0',
                height: '4px',
                background: 'linear-gradient(90deg, #f59e0b, #d97706, #b45309)',
                borderRadius: '20px 20px 0 0'
              }} />
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold text-gray-800 flex items-center">
                  <span className="text-2xl mr-2">🎯</span>
                  SDG Goals Analyzed
                </h3>
                <div className="px-3 py-1 bg-gradient-to-r from-yellow-100 to-orange-100 rounded-full">
                  <span className="text-xs font-bold text-orange-700">Cross-Analysis</span>
                </div>
              </div>
              <div style={{ height: 'calc(100% - 60px)' }}>
                {goalsDistributionData ? (
                  <Doughnut 
                    data={goalsDistributionData} 
                    options={{
                      responsive: true,
                      maintainAspectRatio: false,
                      animation: {
                        duration: 2000,
                        easing: 'easeInOutQuart'
                      },
                      plugins: {
                        legend: {
                          position: 'bottom',
                          labels: {
                            font: {
                              size: 11,
                              weight: '600'
                            },
                            color: '#374151',
                            padding: 15,
                            usePointStyle: true,
                            pointStyle: 'circle'
                          }
                        },
                        tooltip: {
                          backgroundColor: 'rgba(17, 24, 39, 0.95)',
                          titleColor: '#ffffff',
                          bodyColor: '#f3f4f6',
                          borderColor: '#f59e0b',
                          borderWidth: 2,
                          cornerRadius: 12,
                          padding: 16,
                          titleFont: {
                            size: 14,
                            weight: 'bold'
                          },
                          bodyFont: {
                            size: 13
                          },
                          callbacks: {
                            title: function(context) {
                              return '🎯 ' + context[0].label;
                            },
                            label: function(context) {
                              return 'Included in analysis';
                            }
                          }
                        }
                      },
                      cutout: '60%'
                    }} 
                  />
                ) : (
                  <div className="flex items-center justify-center h-full" style={{
                    background: 'linear-gradient(135deg, #fef3c7, #fed7aa)',
                    borderRadius: '12px',
                    border: '2px dashed #f59e0b'
                  }}>
                    <div className="text-center">
                      <span className="text-4xl mb-2 block">🎯</span>
                      <p className="text-orange-700 font-semibold">No goals data available</p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Enhanced Correlation Summary for Correlation Analysis */}
          {analysisType === 'correlation' && correlationData && Object.keys(correlationData).length > 0 && (
            <div style={{
              background: 'linear-gradient(135deg, #ffffff, #f0f9ff)',
              padding: '24px',
              borderRadius: '20px',
              boxShadow: '0 20px 40px -10px rgba(0, 0, 0, 0.15)',
              border: '2px solid rgba(59, 130, 246, 0.1)',
              marginTop: '24px'
            }}>
              <div style={{
                position: 'absolute',
                top: '0',
                left: '0',
                right: '0',
                height: '4px',
                background: 'linear-gradient(90deg, #3b82f6, #1d4ed8, #1e40af)',
                borderRadius: '20px 20px 0 0'
              }} />
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-xl font-bold text-gray-800 flex items-center">
                  <span className="text-2xl mr-3">🔗</span>
                  SDG Goals Correlation Analysis
                </h3>
                <div className="px-4 py-2 bg-gradient-to-r from-blue-100 to-indigo-100 rounded-full">
                  <span className="text-sm font-bold text-blue-700">
                    {Object.keys(correlationData).length} Correlation{Object.keys(correlationData).length > 1 ? 's' : ''}
                  </span>
                </div>
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {Object.entries(correlationData).map(([key, corr]) => {
                  const strengthColor = 
                    Math.abs(corr.correlation) >= 0.7 ? 'border-green-200 bg-green-50' :
                    Math.abs(corr.correlation) >= 0.5 ? 'border-blue-200 bg-blue-50' :
                    Math.abs(corr.correlation) >= 0.3 ? 'border-yellow-200 bg-yellow-50' :
                    'border-gray-200 bg-gray-50';
                  
                  const correlationColor = 
                    Math.abs(corr.correlation) >= 0.7 ? 'text-green-600' :
                    Math.abs(corr.correlation) >= 0.5 ? 'text-blue-600' :
                    Math.abs(corr.correlation) >= 0.3 ? 'text-yellow-600' :
                    'text-gray-600';

                  return (
                    <div key={key} className={`p-6 rounded-xl border-2 ${strengthColor} shadow-sm hover:shadow-md transition-all duration-300`}>
                      <h4 className="font-bold text-gray-800 mb-4 text-center">
                        {key.replace(/SDG_(\d+)_vs_SDG_(\d+)/, 'SDG $1 ↔ SDG $2')}
                      </h4>
                      
                      <div className="text-center mb-4">
                        <div className={`text-3xl font-black ${correlationColor} mb-2`}>
                          {corr.correlation >= 0 ? '+' : ''}{corr.correlation.toFixed(3)}
                        </div>
                        <div className={`text-sm font-semibold px-3 py-1 rounded-full ${
                          Math.abs(corr.correlation) >= 0.7 ? 'bg-green-100 text-green-800' :
                          Math.abs(corr.correlation) >= 0.5 ? 'bg-blue-100 text-blue-800' :
                          Math.abs(corr.correlation) >= 0.3 ? 'bg-yellow-100 text-yellow-800' :
                          'bg-gray-100 text-gray-800'
                        }`}>
                          {corr.strength} {corr.correlation >= 0 ? 'Positive' : 'Negative'}
                        </div>
                      </div>
                      
                      <div className="space-y-2 text-sm">
                        <div className="flex justify-between items-center">
                          <span className="text-gray-600">Sample Size:</span>
                          <span className="font-semibold text-gray-800">{corr.sample_size} districts</span>
                        </div>
                        <div className="flex justify-between items-center">
                          <span className="text-gray-600">Relationship:</span>
                          <span className={`font-semibold ${
                            Math.abs(corr.correlation) >= 0.5 ? 'text-green-600' : 'text-blue-600'
                          }`}>
                            {Math.abs(corr.correlation) >= 0.5 ? 'Significant' : 'Moderate'}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
              
              <div className="mt-6 p-4 bg-blue-50 rounded-lg">
                <h4 className="text-md font-semibold text-blue-800 mb-2">📊 Interpretation Guide</h4>
                <div className="grid grid-cols-2 gap-4 text-sm text-blue-700">
                  <div>
                    <strong>Correlation Strength:</strong>
                    <ul className="mt-1 space-y-1">
                      <li>• 0.7+ : Strong relationship</li>
                      <li>• 0.5-0.7 : Moderate relationship</li>
                    </ul>
                  </div>
                  <div>
                    <strong>Direction:</strong>
                    <ul className="mt-1 space-y-1">
                      <li>• Positive: Goals improve together</li>
                      <li>• Negative: Goals trade-off</li>
                    </ul>
                  </div>
                </div>
              </div>
                         </div>
           )}

          {/* Enhanced Goal Synergies Summary for Goal Synergies Analysis */}
          {analysisType === 'goal_synergies' && analysisResults && analysisResults.length > 0 && (
            <div style={{
              background: 'linear-gradient(135deg, #ffffff, #f5f3ff)',
              padding: '24px',
              borderRadius: '20px',
              boxShadow: '0 20px 40px -10px rgba(0, 0, 0, 0.15)',
              border: '2px solid rgba(139, 92, 246, 0.1)',
              marginTop: '24px'
            }}>
              <div style={{
                position: 'absolute',
                top: '0',
                left: '0',
                right: '0',
                height: '4px',
                background: 'linear-gradient(90deg, #8b5cf6, #7c3aed, #6d28d9)',
                borderRadius: '20px 20px 0 0'
              }} />
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-xl font-bold text-gray-800 flex items-center">
                  <span className="text-2xl mr-3">⚖️</span>
                  SDG Goals Synergies & Trade-offs
                </h3>
                <div className="px-4 py-2 bg-gradient-to-r from-purple-100 to-violet-100 rounded-full">
                  <span className="text-sm font-bold text-purple-700">
                    {analysisResults.length} District{analysisResults.length > 1 ? 's' : ''} Analyzed
                  </span>
                </div>
              </div>
              
              {/* Synergy Patterns Summary */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                {['Balanced Performance', 'Consistent Good', 'High Variance', 'Mixed Performance'].map(pattern => {
                  const count = analysisResults.filter(d => d.synergy_pattern === pattern).length;
                  const percentage = (count / analysisResults.length * 100).toFixed(1);
                  
                  const patternColors = {
                    'Balanced Performance': 'bg-green-50 border-green-200 text-green-800',
                    'Consistent Good': 'bg-blue-50 border-blue-200 text-blue-800', 
                    'High Variance': 'bg-yellow-50 border-yellow-200 text-yellow-800',
                    'Mixed Performance': 'bg-purple-50 border-purple-200 text-purple-800'
                  };

                  return (
                    <div key={pattern} className={`p-4 rounded-lg border-2 ${patternColors[pattern]} text-center`}>
                      <div className="text-2xl font-bold mb-1">{count}</div>
                      <div className="text-xs font-semibold mb-1">{pattern}</div>
                      <div className="text-xs opacity-75">{percentage}% of districts</div>
                    </div>
                  );
                })}
              </div>

              {/* Top Synergy Examples */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="bg-green-50 p-6 rounded-lg border border-green-200">
                  <h4 className="font-bold text-green-800 mb-4 flex items-center">
                    <span className="mr-2">✅</span>
                    Best Synergy Examples
                  </h4>
                  {analysisResults
                    .filter(d => d.synergy_pattern === 'Balanced Performance')
                    .slice(0, 3)
                    .map((district, idx) => (
                      <div key={idx} className="mb-3 last:mb-0">
                        <div className="font-semibold text-green-900">{district.district}, {district.state}</div>
                        <div className="text-sm text-green-700">
                          Avg Performance: {(district.avg_performance || 0).toFixed(1)}% | 
                          Gap: {(district.performance_gap || 0).toFixed(1)}
                        </div>
                      </div>
                    ))}
                </div>

                <div className="bg-yellow-50 p-6 rounded-lg border border-yellow-200">
                  <h4 className="font-bold text-yellow-800 mb-4 flex items-center">
                    <span className="mr-2">⚠️</span>
                    High Variance Examples
                  </h4>
                  {analysisResults
                    .filter(d => d.synergy_pattern === 'High Variance')
                    .slice(0, 3)
                    .map((district, idx) => (
                      <div key={idx} className="mb-3 last:mb-0">
                        <div className="font-semibold text-yellow-900">{district.district}, {district.state}</div>
                        <div className="text-sm text-yellow-700">
                          Avg Performance: {(district.avg_performance || 0).toFixed(1)}% | 
                          Gap: {(district.performance_gap || 0).toFixed(1)}
                        </div>
                      </div>
                    ))}
                </div>
              </div>
              
              <div className="mt-6 p-4 bg-purple-50 rounded-lg">
                <h4 className="text-md font-semibold text-purple-800 mb-2">⚖️ Synergy Analysis Guide</h4>
                <div className="grid grid-cols-2 gap-4 text-sm text-purple-700">
                  <div>
                    <strong>Synergy Patterns:</strong>
                    <ul className="mt-1 space-y-1">
                      <li>• <span className="text-green-700">Balanced</span>: Consistent across goals</li>
                      <li>• <span className="text-yellow-700">High Variance</span>: Strong in some, weak in others</li>
                    </ul>
                  </div>
                  <div>
                    <strong>Performance Gap:</strong>
                    <ul className="mt-1 space-y-1">
                      <li>• Lower gap = Better synergy</li>
                      <li>• Higher gap = Need targeted interventions</li>
                    </ul>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {viewMode === 'detailed' && (
        <div className="space-y-6">
          <h3 className="text-xl font-bold text-gray-800">Detailed Analysis Results</h3>
          
          <div className="overflow-x-auto">
            <table className="min-w-full bg-white border border-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">District</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">State</th>
                  {analysisType === 'multi_goal_performance' && (
                    <>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Performance</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Consistency</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Category</th>
                    </>
                  )}
                  {analysisType === 'correlation' && (
                    sdgGoals.map(goal => (
                      <th key={goal} className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        SDG {goal} Score
                      </th>
                    ))
                  )}
                  {analysisType === 'best_worst_performers' && (
                    <>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Category</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Performance</th>
                    </>
                  )}
                  {analysisType === 'goal_synergies' && (
                    <>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Avg Performance</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Performance Gap</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Synergy Pattern</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Goals Covered</th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {analysisResults.slice(0, 20).map((item, index) => (
                  <tr key={index} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                      {item.district}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {item.state}
                    </td>
                    {analysisType === 'multi_goal_performance' && (
                      <>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className={`text-sm font-medium ${getPerformanceColor(item.overall_performance || 0)}`}>
                            {(item.overall_performance || 0).toFixed(1)}%
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          {item.consistency_rating || 'N/A'}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          {item.performance_category || 'N/A'}
                        </td>
                      </>
                    )}
                    {analysisType === 'correlation' && (
                      sdgGoals.map(goal => (
                        <td key={goal} className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          {(item[`sdg_${goal}_score`] || 0).toFixed(1)}
                        </td>
                      ))
                    )}
                    {analysisType === 'best_worst_performers' && (
                      <>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className={`px-2 py-1 text-xs rounded-full ${
                            item.category === 'Best Performers' 
                              ? 'bg-green-100 text-green-800' 
                              : 'bg-red-100 text-red-800'
                          }`}>
                            {item.category}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          {(item.combined_performance || 0).toFixed(1)}
                        </td>
                      </>
                    )}
                    {analysisType === 'goal_synergies' && (
                      <>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className={`text-sm font-medium ${getPerformanceColor(item.avg_performance || 0)}`}>
                            {(item.avg_performance || 0).toFixed(1)}%
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          {(item.performance_gap || 0).toFixed(1)}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className={`px-2 py-1 text-xs rounded-full ${
                            item.synergy_pattern === 'Balanced Performance' ? 'bg-green-100 text-green-800' :
                            item.synergy_pattern === 'Consistent Good' ? 'bg-blue-100 text-blue-800' :
                            item.synergy_pattern === 'High Variance' ? 'bg-yellow-100 text-yellow-800' :
                            item.synergy_pattern === 'Consistent Poor' ? 'bg-red-100 text-red-800' :
                            'bg-gray-100 text-gray-800'
                          }`}>
                            {item.synergy_pattern || 'Unknown'}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          {item.goals_covered || 0}
                        </td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {viewMode === 'correlations' && analysisType === 'correlation' && (
        <div className="space-y-6">
          <h3 className="text-xl font-bold text-gray-800">Correlation Analysis</h3>
          
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {Object.entries(correlationData).map(([key, corr]) => (
              <div key={key} className="bg-gray-50 p-4 rounded-lg border">
                <h4 className="font-semibold text-gray-800 mb-2">
                  {key.replace(/SDG_(\d+)_vs_SDG_(\d+)/, 'SDG $1 vs SDG $2')}
                </h4>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span>Correlation:</span>
                    <span className={`font-medium ${
                      Math.abs(corr.correlation) >= 0.5 ? 'text-green-600' :
                      Math.abs(corr.correlation) >= 0.3 ? 'text-blue-600' : 'text-gray-600'
                    }`}>
                      {corr.correlation.toFixed(3)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>Strength:</span>
                    <span>{corr.strength}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Sample Size:</span>
                    <span>{corr.sample_size}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Enhanced Map View */}
      {viewMode === 'map' && (
        <div className="space-y-4">
          {/* Compact Summary Bar */}
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
                    {summary.total_districts}
                  </div>
                  <div style={{ fontSize: '11px', color: '#1d4ed8', fontWeight: '600', textTransform: 'uppercase' }}>
                    DISTRICTS
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
                    {summary.analysis_coverage}
                  </div>
                  <div style={{ fontSize: '11px', color: '#059669', fontWeight: '600', textTransform: 'uppercase' }}>
                    SDG GOALS
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
                    {summary.avg_performance.toFixed(0)}%
                  </div>
                  <div style={{ fontSize: '11px', color: '#ea580c', fontWeight: '600', textTransform: 'uppercase' }}>
                    AVG PERFORMANCE
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
                    {summary.total_states}
                  </div>
                  <div style={{ fontSize: '11px', color: '#dc2626', fontWeight: '600', textTransform: 'uppercase' }}>
                    STATES
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
                <span style={{ fontSize: '18px' }}>🔍</span>
                <span style={{ fontSize: '13px' }}>Click districts for details</span>
              </div>
            </div>
          </div>

          {/* Map Legend */}
          <div style={{
            position: 'absolute',
            top: '20px',
            right: '20px',
            background: 'rgba(255, 255, 255, 0.95)',
            padding: '16px',
            borderRadius: '12px',
            boxShadow: '0 8px 32px rgba(0,0,0,0.12)',
            border: '1px solid rgba(0,0,0,0.08)',
            zIndex: 10,
            minWidth: '250px'
          }}>
            <h4 style={{ margin: '0 0 12px 0', fontSize: '14px', fontWeight: 'bold', color: '#1f2937' }}>
              Cross-SDG Analysis Legend
            </h4>
            
            <div style={{ marginBottom: '12px' }}>
              <div style={{ fontSize: '12px', fontWeight: '600', color: '#374151', marginBottom: '6px' }}>
                SDG Goals Analyzed:
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                {sdgGoals.map((goal, index) => (
                  <span key={goal} style={{
                    background: ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'][index % 5],
                    color: 'white',
                    padding: '2px 8px',
                    borderRadius: '12px',
                    fontSize: '11px',
                    fontWeight: '600'
                  }}>
                    SDG {goal}
                  </span>
                ))}
              </div>
            </div>

            <div style={{ marginBottom: '8px' }}>
              <div style={{ fontSize: '12px', fontWeight: '600', color: '#374151', marginBottom: '6px' }}>
                Performance Levels:
              </div>
              {analysisType === 'best_worst_performers' ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <div style={{ width: '16px', height: '16px', background: '#10b981', borderRadius: '3px' }}></div>
                    <span style={{ fontSize: '11px', color: '#374151' }}>Best Performers</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <div style={{ width: '16px', height: '16px', background: '#ef4444', borderRadius: '3px' }}></div>
                    <span style={{ fontSize: '11px', color: '#374151' }}>Worst Performers</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <div style={{ width: '16px', height: '16px', background: '#94a3b8', borderRadius: '3px' }}></div>
                    <span style={{ fontSize: '11px', color: '#374151' }}>No Data</span>
                  </div>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <div style={{ width: '16px', height: '16px', background: '#10b981', borderRadius: '3px' }}></div>
                    <span style={{ fontSize: '11px', color: '#374151' }}>High (75-100%)</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <div style={{ width: '16px', height: '16px', background: '#3b82f6', borderRadius: '3px' }}></div>
                    <span style={{ fontSize: '11px', color: '#374151' }}>Good (50-74%)</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <div style={{ width: '16px', height: '16px', background: '#f59e0b', borderRadius: '3px' }}></div>
                    <span style={{ fontSize: '11px', color: '#374151' }}>Moderate (25-49%)</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <div style={{ width: '16px', height: '16px', background: '#ef4444', borderRadius: '3px' }}></div>
                    <span style={{ fontSize: '11px', color: '#374151' }}>Low (1-24%)</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <div style={{ width: '16px', height: '16px', background: '#94a3b8', borderRadius: '3px' }}></div>
                    <span style={{ fontSize: '11px', color: '#374151' }}>No Data</span>
                  </div>
                </div>
              )}
            </div>

            <div style={{ fontSize: '10px', color: '#6b7280', marginTop: '8px', borderTop: '1px solid #e5e7eb', paddingTop: '8px' }}>
              Analysis: {getAnalysisTypeLabel(analysisType)}<br/>
              Districts with data: {mapFeatures.filter(f => f.properties.analysisData).length}/{mapFeatures.length}
            </div>
          </div>

          {/* Map Container */}
          <div className="border border-gray-300 rounded-lg overflow-hidden shadow-lg" style={{ height: '600px', position: 'relative' }}>
            <Map
              {...viewState}
              onMove={evt => setViewState(evt.viewState)}
              style={{ width: '100%', height: '100%' }}
              mapStyle="mapbox://styles/mapbox/light-v10"
              mapboxAccessToken={MAPBOX_TOKEN}
              interactiveLayerIds={['district-fill']}
              onClick={handleDistrictClick}
            >
              {normalizedFeatures.length > 0 && (
                <Source
                  id="districts"
                  type="geojson"
                  data={{
                    type: "FeatureCollection",
                    features: normalizedFeatures
                  }}
                >
                  <Layer
                    id="district-fill"
                    type="fill"
                    paint={{
                      'fill-color': ['get', 'color'],
                      'fill-opacity': 0.8
                    }}
                  />
                  <Layer
                    id="district-border"
                    type="line"
                    paint={{
                      'line-color': '#1f2937',
                      'line-width': 0.5,
                      'line-opacity': 0.5
                    }}
                  />
                </Source>
              )}

              {/* Selected District Info Panel */}
              {selectedDistrict && (
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
                        {selectedDistrict.district}
                      </h4>
                      <p style={{ margin: '2px 0 0 0', color: '#6b7280', fontSize: '13px' }}>
                        {selectedDistrict.state} State
                      </p>
                    </div>
                    <button
                      onClick={() => setSelectedDistrict(null)}
                      style={{
                        background: '#f3f4f6',
                        border: 'none',
                        borderRadius: '6px',
                        width: '28px',
                        height: '28px',
                        fontSize: '16px',
                        cursor: 'pointer',
                        color: '#6b7280'
                      }}
                    >
                      ×
                    </button>
                  </div>
                  
                  <div style={{ marginBottom: '12px' }}>
                    <div style={{ 
                      fontSize: '12px', 
                      fontWeight: '600', 
                      color: '#374151', 
                      marginBottom: '4px' 
                    }}>
                      Cross-SDG Performance Score
                    </div>
                    <div style={{ 
                      fontSize: '20px', 
                      fontWeight: 'bold', 
                      color: selectedDistrict.performanceScore >= 75 ? '#059669' :
                             selectedDistrict.performanceScore >= 50 ? '#2563eb' :
                             selectedDistrict.performanceScore >= 25 ? '#d97706' : '#dc2626'
                    }}>
                      {selectedDistrict.performanceScore?.toFixed(1)}%
                    </div>
                    <div style={{ fontSize: '11px', color: '#6b7280' }}>
                      Category: {selectedDistrict.category}
                    </div>
                  </div>

                  {/* SDG Goals Performance Breakdown */}
                  {selectedDistrict.analysisData && analysisType === 'correlation' && (
                    <div style={{ marginBottom: '12px' }}>
                      <div style={{ fontSize: '12px', fontWeight: '600', color: '#374151', marginBottom: '6px' }}>
                        SDG Goals Performance:
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        {sdgGoals.map((goal, index) => {
                          const scoreKey = `sdg_${goal}_score`;
                          const score = selectedDistrict.analysisData[scoreKey];
                          if (score != null) {
                            return (
                              <div key={goal} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <span style={{ 
                                  fontSize: '11px', 
                                  color: ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'][index % 5],
                                  fontWeight: '600'
                                }}>
                                  SDG {goal}
                                </span>
                                <span style={{ fontSize: '11px', fontWeight: '600', color: '#1f2937' }}>
                                  {parseFloat(score).toFixed(1)}%
                                </span>
                              </div>
                            );
                          }
                          return null;
                        })}
                      </div>
                    </div>
                  )}

                  {selectedDistrict.analysisData && (
                    <div style={{ fontSize: '12px', color: '#6b7280' }}>
                      <div style={{ marginBottom: '4px' }}>
                        Analysis Type: {getAnalysisTypeLabel(analysisType)}
                      </div>
                      <div style={{ marginBottom: '4px' }}>
                        SDG Goals: {sdgGoals.join(', ')}
                      </div>
                      {analysisType === 'multi_goal_performance' && (
                        <div>
                          Consistency: {selectedDistrict.analysisData.consistency_rating || 'N/A'}
                        </div>
                      )}
                      {analysisType === 'goal_synergies' && (
                        <div>
                          Synergy Pattern: {selectedDistrict.analysisData.synergy_pattern || 'N/A'}
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

      {/* Analysis Notes */}
      {viewMode === 'map' && (
        <div className="mt-6 p-4 bg-blue-50 rounded-lg">
          <h3 className="text-lg font-semibold text-blue-800 mb-2">Analysis Notes</h3>
          <ul className="text-sm text-blue-700 space-y-1">
            <li>• Cross-SDG analysis examines relationships between SDG Goals {sdgGoals.join(', ')}</li>
            <li>• Performance scores are calculated based on {getAnalysisTypeLabel(analysisType).toLowerCase()}</li>
            <li>• District colors represent performance levels: Green (High), Blue (Good), Yellow (Moderate), Red (Low)</li>
            <li>• Click districts on the map to view detailed cross-SDG metrics</li>
          </ul>
        </div>
      )}
    </div>
  );
};

export default CrossSDGAnalysis; 