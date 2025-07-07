import React from 'react';
import IndividualDistrictAnalysis from './IndividualDistrictAnalysis';

// Mock data structure that matches what the backend returns
const mockIndividualDistrictData = {
  data: [
    {
      result: {
        success: true,
        district: "Mumbai",
        state: "Maharashtra", 
        year: 2021,
        sdg_goals_data: [
          {
            sdg_goal: 1,
            indicators: [
              {
                indicator_name: "multidimensional_poverty",
                indicator_full_name: "Multidimensional Poverty",
                nfhs_4_value: 3.34,
                nfhs_5_value: 0.92,
                annual_change: -0.48,
                change_interpretation: {
                  is_improvement: true,
                  trend_icon: "↗️",
                  description: "Improved by 0.48 reduction (positive trend)"
                }
              },
              {
                indicator_name: "health_insurance_women",
                indicator_full_name: "Health Insurance Coverage (Women)",
                nfhs_4_value: 6.85,
                nfhs_5_value: 13.49,
                annual_change: 1.33,
                change_interpretation: {
                  is_improvement: true,
                  trend_icon: "↗️",
                  description: "Improved by +1.33 (positive trend)"
                }
              }
            ],
            total_indicators: 2,
            improving_indicators: 2,
            deteriorating_indicators: 0
          }
        ],
        summary: {
          total_indicators: 2,
          improving_indicators: 2,
          deteriorating_indicators: 0,
          stable_indicators: 0,
          improvement_rate: 100.0,
          sdg_goals_covered: 1
        },
        analysis_type: "individual_district",
        map_type: "individual_district_analysis"
      }
    }
  ],
  boundary: [
    {
      district: "Mumbai",
      state: "Maharashtra",
      geometry: {
        type: "Polygon",
        coordinates: [[[72.8, 18.9], [72.9, 18.9], [72.9, 19.0], [72.8, 19.0], [72.8, 18.9]]]
      }
    }
  ],
  function_calls: [
    {
      function: "get_individual_district_sdg_data",
      arguments: { district_name: "Mumbai", sdg_goal_number: 1 }
    }
  ]
};

export default function IndividualDistrictAnalysisVisualTest() {
  return (
    <div style={{ padding: '20px' }}>
      <h2>Individual District Analysis Test</h2>
      <p>Testing with Mumbai SDG Goal 1 data</p>
      <div style={{ border: '1px solid #ccc', padding: '20px', marginTop: '20px' }}>
        <IndividualDistrictAnalysis 
          data={mockIndividualDistrictData} 
          boundary={mockIndividualDistrictData.boundary}
          chartOnly={false}
          isModal={false}
        />
      </div>
    </div>
  );
} 