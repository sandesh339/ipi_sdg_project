import React from 'react';
import { Bar, Pie } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend,
  ArcElement,
} from 'chart.js';

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend,
  ArcElement
);

const ChartTest = () => {
  const testData = {
    labels: ['Achieved-I', 'Achieved-II', 'Off-Target'],
    datasets: [{
      label: 'Test Data',
      data: [12, 19, 8],
      backgroundColor: ['#1a5d1a', '#2d8f2d', '#d32f2f'],
    }]
  };

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: 'bottom',
      },
      title: {
        display: true,
        text: 'Chart.js Test',
      },
    },
  };

  return (
    <div style={{ padding: '20px' }}>
      <h2>Chart.js Test Component</h2>
      <div style={{ height: '300px', width: '100%', marginBottom: '20px' }}>
        <Bar data={testData} options={options} />
      </div>
      <div style={{ height: '300px', width: '100%' }}>
        <Pie data={testData} options={options} />
      </div>
    </div>
  );
};

export default ChartTest; 