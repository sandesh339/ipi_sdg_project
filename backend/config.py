"""
Configuration settings for SDG Chatbot
"""
import os

# Database Configuration
DATABASE_CONFIG = {
    'dbname': os.getenv('SDG_DB_NAME', 'sdgquery'),
    'user': os.getenv('SDG_DB_USER', 'postgres'),
    'password': os.getenv('SDG_DB_PASSWORD', 'Happy123-'),
    'host': os.getenv('SDG_DB_HOST', 'localhost'),
    'port': os.getenv('SDG_DB_PORT', '5432')
}

# OpenAI Configuration

OPENAI_MODEL = os.getenv('OPENAI_MODEL', 'gpt-4o-2024-08-06')

# API Configuration
API_HOST = os.getenv('API_HOST', '0.0.0.0')
API_PORT = int(os.getenv('API_PORT', 8000))
API_RELOAD = os.getenv('API_RELOAD', 'True').lower() == 'true'

# Conversation Management
MAX_TOKENS = int(os.getenv('MAX_TOKENS', 128000))
SAFE_TOKEN_LIMIT = int(MAX_TOKENS * 0.4)
MAX_HISTORY_MESSAGES = int(os.getenv('MAX_HISTORY_MESSAGES', 7))

# Default Query Settings
DEFAULT_TOP_N = int(os.getenv('DEFAULT_TOP_N', 5))
DEFAULT_YEAR = int(os.getenv('DEFAULT_YEAR', 2021))

# Supported years
SUPPORTED_YEARS = [2016, 2021]

# SDG Goals configuration
SDG_GOALS = {
    1: "No Poverty",
    2: "Zero Hunger", 
    3: "Good Health and Well-being",
    4: "Quality Education",
    5: "Gender Equality",
    6: "Clean Water and Sanitation",
    7: "Affordable and Clean Energy",
    8: "Decent Work and Economic Growth",
    9: "Industry, Innovation and Infrastructure",
    10: "Reduced Inequalities",
    11: "Sustainable Cities and Communities",
    12: "Responsible Consumption and Production",
    13: "Climate Action",
    14: "Life Below Water",
    15: "Life on Land",
    16: "Peace, Justice and Strong Institutions",
    17: "Partnerships for the Goals"
}

# Available SDG Goals with data (update based on your data)
AVAILABLE_SDG_GOALS = [1, 2, 3, 5, 6, 7, 8, 16, 17]

# CORS Configuration
CORS_ORIGINS = os.getenv('CORS_ORIGINS', '*').split(',')

# Logging Configuration
LOG_LEVEL = os.getenv('LOG_LEVEL', 'INFO')
LOG_FORMAT = '%(asctime)s - %(name)s - %(levelname)s - %(message)s'

# System message for OpenAI
SYSTEM_MESSAGE = {
    "role": "system", 
    "content": (
        "You are an AI assistant specialized in analyzing Sustainable Development Goals (SDG) data for Indian districts. "
        "You help users explore SDG indicators, compare district performance, identify trends, and provide insights "
        "for policy making and development planning. Your responses should be clear, data-driven, and actionable. "
        "When users ask about SDG goals by number, always show available indicators and let them choose specific ones for analysis. "
        f"Available SDG Goals with data: {', '.join(map(str, AVAILABLE_SDG_GOALS))}. "
        f"Available years: {', '.join(map(str, SUPPORTED_YEARS))}."
    )
}