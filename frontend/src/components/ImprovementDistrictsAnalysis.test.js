import React from 'react';
import { render } from '@testing-library/react';
import ImprovementDistrictsAnalysis from './ImprovementDistrictsAnalysis';

// Mock Chart.js components
jest.mock('react-chartjs-2', () => ({
  Bar: () => <div data-testid="bar-chart">Bar Chart</div>,
  Line: () => <div data-testid="line-chart">Line Chart</div>,
  Doughnut: () => <div data-testid="doughnut-chart">Doughnut Chart</div>,
  Radar: () => <div data-testid="radar-chart">Radar Chart</div>,
}));

// Mock mapbox-gl
jest.mock('mapbox-gl', () => ({
  Map: jest.fn(() => ({
    on: jest.fn(),
    addSource: jest.fn(),
    addLayer: jest.fn(),
    remove: jest.fn(),
  })),
  accessToken: '',
}));

const mockImprovementData = {
  districts: [
    {
      district_name: 'Test District 1',
      state_name: 'Test State',
      improvement_score: 2.5,
      current_value: 85.2,
      actual_annual_change: 2.5,
      indicator_name: 'Test Indicator',
      rank: 1
    },
    {
      district_name: 'Test District 2',
      state_name: 'Test State',
      improvement_score: -1.2,
      current_value: 72.8,
      actual_annual_change: -1.2,
      indicator_name: 'Test Indicator',
      rank: 2
    }
  ],
  query_type: 'most_improved',
  sdg_goal_number: 3,
  indicator_distribution: {
    'Test Indicator': 2
  },
  analysis: 'Test analysis text',
  boundary_data: []
};

describe('ImprovementDistrictsAnalysis', () => {
  test('renders without crashing with basic data', () => {
    render(<ImprovementDistrictsAnalysis improvementData={mockImprovementData} />);
  });

  test('renders chart only mode', () => {
    render(
      <ImprovementDistrictsAnalysis 
        improvementData={mockImprovementData} 
        chartOnly={true} 
      />
    );
  });

  test('renders map only mode', () => {
    render(
      <ImprovementDistrictsAnalysis 
        improvementData={mockImprovementData} 
        mapOnly={true} 
      />
    );
  });

  test('handles empty data gracefully', () => {
    const emptyData = { districts: [] };
    render(<ImprovementDistrictsAnalysis improvementData={emptyData} />);
  });

  test('handles null data gracefully', () => {
    render(<ImprovementDistrictsAnalysis improvementData={null} />);
  });
}); 