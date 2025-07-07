from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import json
from openai import OpenAI
from openai import OpenAIError
from fastapi.middleware.cors import CORSMiddleware
import psycopg2
from sdg_utils import (
    get_sdg_goal_data,
    format_sdg_goal_response,
    get_db_connection,
    get_indicators_by_sdg_goal,
    get_sdg_goal_classification,
    extract_district_name_from_query,
    get_individual_district_sdg_data,
    get_district_indicator_selection_prompt,
    get_best_worst_district_for_indicator,
    get_aac_classification,
    fuzzy_match_indicator,
    get_district_boundary_data,
    get_specific_indicator_data,
    get_overall_sdg_goal_data,
    get_state_wise_summary,
    get_time_series_comparison,
    get_aspirational_district_tracking,
    get_cross_sdg_analysis,
    get_neighboring_districts_comparison,
    get_state_wise_indicator_extremes,
    get_most_least_improved_districts,
    get_border_districts,
    get_districts_within_radius
)
import tiktoken
from datetime import datetime

# Constants for conversation management
MAX_HISTORY_MESSAGES = 7  
SYSTEM_MESSAGE = {
    "role": "system", 
    "content": """You are an advanced SDG (Sustainable Development Goals) Analysis Assistant for India, specializing in district-level performance data from NFHS-4 (2016) and NFHS-5 (2021) surveys.

**CORE CAPABILITIES:**
1. **SDG Performance Analysis**: Analyze 17 SDG goals across 640+ Indian districts
2. **District Comparisons**: Compare top/bottom performers, trends, and classifications  
3. **Individual District Insights**: Comprehensive profiles for specific districts
4. **Neighboring Districts Analysis**: Compare districts with their spatial neighbors using geographic proximity
5. **State-wise Aggregations**: Compare state-level SDG performance and trends
6. **Time Series Analysis**: Track 2016-2021 changes and improvement patterns
7. **Aspirational District Tracking**: Monitor India's 115 aspirational districts program
8. **Cross-SDG Analysis**: Examine correlations and synergies between different goals
9. **Classification Systems**: SDG status (Achieved-I, Achieved-II, On-Target and Off-Target) and performance categories

**WORKFLOW GUIDELINES:**

**For SDG Goal Queries:**
- SDG Goals 8 & 17: Use get_sdg_goal_data() directly (only 1 indicator each)
- Other goals: First call get_indicators_by_sdg_goal() to show available indicators, then get_sdg_goal_data()
- Use appropriate query_type: individual, top_performers, bottom_performers, trend

**For District-Specific Queries:**
- Use get_individual_district_sdg_data() for specific district analysis
- Automatically handles fuzzy district name matching
- Provides comprehensive NFHS-4/NFHS-5 comparison with trends

**For Classification/Mapping:**
- Use get_sdg_goal_classification() for district classification visualization
- Returns all indicators with dropdown selection capability
- Includes boundary data for map visualization

**For Advanced Analysis:**
- get_state_wise_summary(): State-level aggregations and comparisons
- get_time_series_comparison(): NFHS-4 to NFHS-5 trend analysis  
- get_aspirational_district_tracking(): Aspirational districts performance monitoring
- get_cross_sdg_analysis(): Multi-goal correlations and synergies
- get_neighboring_districts_comparison(): Compare districts with their spatial neighbors

**RESPONSE STRATEGY:**
1. **Understanding**: Analyze user intent (performance ranking, specific district, trends, classifications)
2. **Function Selection**: Choose appropriate function based on query type and scope
3. **Data Analysis**: Process results with focus on key insights and trends
4. **Interpretation**: Provide context on improvement directions, annual changes, and policy relevance
5. **Visualization**: Highlight map-worthy data and classification insights

**KEY PRINCIPLES:**
- Always interpret annual change values considering indicator direction (higher/lower is better)
- Provide policy-relevant insights for development planning
- Highlight aspirational district status when relevant  
- Explain data trends and their significance for SDG achievement
- Support both technical analysis and accessible explanations

**DATA CONTEXT:**
- 640+ districts across all Indian states
- 17 SDG goals with multiple indicators each
- NFHS-4 (2016) baseline vs NFHS-5 (2021) comparison
- Annual change calculations with direction-aware interpretation
- Aspirational district program tracking for targeted development

You excel at transforming complex SDG data into actionable insights for policy makers, researchers, and development practitioners."""
}

MAX_TOKENS = 128000  
SAFE_TOKEN_LIMIT = int(MAX_TOKENS * 0.4)  

def count_tokens(messages, model="gpt-4o"):
    """Count tokens in messages with explicit encoding handling"""
    try:
        # Try to get encoding for the specific model
        enc = tiktoken.encoding_for_model(model)
    except KeyError:
        # Fallback to cl100k_base encoding for GPT-4 models
        enc = tiktoken.get_encoding("cl100k_base")
    
    num_tokens = 0
    for message in messages:
        num_tokens += 4  # every message follows <|start|>{role/name}\n{content}<|end|>\n
        for key, value in message.items():
            num_tokens += len(enc.encode(str(value)))
            if key == "name":  # if there's a name, the role is omitted
                num_tokens += -1  # role is always required and always 1 token
    num_tokens += 2  # every reply is primed with <|start|>assistant
    return num_tokens

def manage_conversation_history(history: list, new_message: dict, model="gpt-4o") -> list:
    """
    Manage conversation history by token count.
    Always keeps the system message and as many recent messages as possible under the token limit.
    """
    # Ensure system message is always present
    if not history or history[0].get("role") != "system":
        history = [SYSTEM_MESSAGE] + history

    # Add the new message
    history.append(new_message)

    # Aggressive trimming to stay under token limit
    while count_tokens(history, model=model) > SAFE_TOKEN_LIMIT and len(history) > 3:
        history.pop(1)
    
    # If still too large, keep only system message and last 2 messages
    if count_tokens(history, model=model) > SAFE_TOKEN_LIMIT and len(history) > 3:
        history = [history[0]] + history[-2:]
    
    # Final safety check - truncate last message if needed
    if count_tokens(history, model=model) > SAFE_TOKEN_LIMIT and len(history) > 1:
        last_message = history[-1]
        if len(last_message.get("content", "")) > 1000:
            last_message["content"] = last_message["content"][:800] + "... [Message truncated]"

    return history

def analyze_sdg_query_intent(user_query):
    """
    Analyze user query to determine SDG query intent and parameters.
    """
    query_lower = user_query.lower()
    
    # Check for ranking/comparison keywords
    ranking_keywords = {
        "top": ["top", "best", "highest", "leading", "superior", "good", "better", "performing well"],
        "bottom": ["bottom", "worst", "lowest", "poorest", "lagging", "bad", "worse", "performing poorly"],
        "both": ["compare", "comparison", "trend", "both", "top and bottom", "versus", "vs"]
    }
    
    # Enhanced district detection - check for common district names and patterns
    detected_district = extract_district_name_from_query(user_query)
    has_specific_district = detected_district is not None
    
    # Also check for common district indicators in the query
    district_keywords = ["district", "city", "area", "region", "place", "in ", "of ", "for "]
    has_district_pattern = any(keyword in query_lower for keyword in district_keywords)
    
    # Check for best/worst performing district queries
    is_best_worst_query = any(word in query_lower for word in ["best performing", "worst performing", "top performing", "bottom performing", "best district", "worst district"])
    
    # Extract numbers for top_n
    import re
    number_patterns = [
        r"top\s+(\d+)", r"bottom\s+(\d+)", r"(\d+)\s+best", r"(\d+)\s+worst",
        r"(\d+)\s+districts", r"show\s+(\d+)", r"list\s+(\d+)", r"first\s+(\d+)"
    ]
    
    top_n = None
    for pattern in number_patterns:
        match = re.search(pattern, query_lower)
        if match:
            top_n = int(match.group(1))
            break
    
    # Default top_n based on query type
    if top_n is None:
        if any(word in query_lower for word in ["many", "all", "list"]):
            top_n = 10
        else:
            top_n = 5
    
    # Determine query type with enhanced district detection
    query_type = "top_performers"  # default for multiple districts
    
    if has_specific_district and not is_best_worst_query:
        query_type = "individual_district"  # New query type for specific district queries
    elif is_best_worst_query:
        # Determine if it's best or worst performing district query
        if any(word in query_lower for word in ["best", "top", "highest", "leading"]):
            query_type = "best_district"
        else:
            query_type = "worst_district"
    elif any(word in query_lower for word in ranking_keywords["both"]):
        query_type = "trend"
    elif any(word in query_lower for word in ranking_keywords["bottom"]):
        query_type = "bottom_performers"
    elif any(word in query_lower for word in ranking_keywords["top"]):
        query_type = "top_performers"
    elif any(word in query_lower for word in ["districts", "list", "ranking", "performance", "status"]):
        query_type = "top_performers"  # default for multiple districts
    
    # Extract state information
    state_keywords = {
        "rajasthan": ["rajasthan"],
        "gujarat": ["gujarat"],
        "maharashtra": ["maharashtra"],
        "karnataka": ["karnataka"],
        "tamil nadu": ["tamil nadu", "tamilnadu"],
        "kerala": ["kerala"],
        "west bengal": ["west bengal", "bengal"],
        "uttar pradesh": ["uttar pradesh", "up"],
        "bihar": ["bihar"],
        "odisha": ["odisha", "orissa"]
    }
    
    detected_state = None
    for state, keywords in state_keywords.items():
        if any(keyword in query_lower for keyword in keywords):
            detected_state = state
            break
    
    return {
        "query_type": query_type,
        "top_n": top_n,
        "state_name": detected_state,
        "has_specific_district": has_specific_district,
        "detected_district": detected_district,
        "is_best_worst_query": is_best_worst_query,
        "has_district_pattern": has_district_pattern
    }

app = FastAPI()
app.add_middleware(
    CORSMiddleware, 
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"]
)

client = OpenAI(
    api_key=os.getenv("OPEN_API_KEY")
)

# Session storage
session_store = {
    "history": []
}

class ChatbotRequest(BaseModel):
    query: str
    history: list[dict] | None = None

class MostLeastImprovedRequest(BaseModel):
    sdg_goal_number: int
    indicator_name: str | None = None
    query_type: str = "most_improved"  # "most_improved" or "least_improved"
    top_n: int = 5
    state_name: str | None = None

@app.get("/")
def home():
    return {"message": "SDG Chatbot Backend is running!"}

@app.post("/chatbot/")
async def chatbot(request: ChatbotRequest):
    try:
        # Test database connection
        try:
            conn = get_db_connection()
            conn.close()
        except psycopg2.Error as e:
            raise HTTPException(status_code=500, detail=f"Database connection error: {str(e)}")

        user_input = request.query
        print("User query:", user_input)
        session = session_store

        if "history" not in session:
            session["history"] = [SYSTEM_MESSAGE]

        # Add user message to history
        user_message = {"role": "user", "content": user_input}
        session["history"] = manage_conversation_history(session["history"], user_message)

        def execute_function_call(function_name, arguments):
            """Execute a single function call and return the result"""
            if function_name == "get_sdg_goal_data":
                # Use centralized query intent analysis
                query_intent = analyze_sdg_query_intent(user_input)
                
                # Use OpenAI suggested parameters if they exist, otherwise use analyzed intent
                final_query_type = arguments.get("query_type", query_intent["query_type"])
                final_top_n = arguments.get("top_n", query_intent["top_n"])
                final_state_name = arguments.get("state_name") or query_intent.get("state_name")
                
                # Capitalize state name properly for database query
                if final_state_name:
                    final_state_name = final_state_name.title()
                
                print(f"Query analysis: {query_intent}")
                print(f"OpenAI suggested: query_type={arguments.get('query_type')}, top_n={arguments.get('top_n')}")
                print(f"Final parameters: query_type={final_query_type}, top_n={final_top_n}")
                print(f"Indicator names from AI: {arguments.get('indicator_names')}")
                print(f"State name: {final_state_name}")

                result = get_sdg_goal_data(
                    sdg_goal_number=arguments.get("sdg_goal_number"),
                    indicator_names=arguments.get("indicator_names"),
                    year=arguments.get("year", 2021),
                    query_type=final_query_type,
                    top_n=final_top_n,
                    district_name=arguments.get("district_name"),
                    state_name=final_state_name,
                    include_labels=arguments.get("include_labels", True)
                )
                # Safe result summary printing
                try:
                    if isinstance(result, dict) and 'data' in result:
                        data = result['data']
                        if isinstance(data, dict) and 'combined_data' in data:
                            top_count = len(data.get('top_performers', []))
                            bottom_count = len(data.get('bottom_performers', []))
                            print(f"Function result summary: {top_count} top, {bottom_count} bottom performers")
                        elif isinstance(data, list):
                            print(f"Function result summary: {len(data)} districts returned")
                        else:
                            print(f"Function result summary: data type = {type(data)}")
                    else:
                        print(f"Function result summary: result type = {type(result)}")
                except Exception as e:
                    print(f"Function result summary: error getting summary - {e}")
                return result
            
            elif function_name == "get_indicators_by_sdg_goal":
                result = get_indicators_by_sdg_goal(
                    sdg_goal_number=arguments["sdg_goal_number"]
                )
                return result
            
            # REMOVED: get_indicators_for_classification, classify_districts_by_sdg_status, 
            # get_comprehensive_district_classification - All functionality moved to get_sdg_goal_classification
            
            elif function_name == "get_sdg_goal_classification":
                result = get_sdg_goal_classification(
                    sdg_goal_number=arguments["sdg_goal_number"],
                    year=arguments.get("year", 2021),
                    state_name=arguments.get("state_name"),
                    classification_type=arguments.get("classification_type", "status"),
                    default_indicator=arguments.get("default_indicator")
                )
                return result
            
            elif function_name == "get_individual_district_sdg_data":
                result = get_individual_district_sdg_data(
                    district_name=arguments["district_name"],
                    sdg_goal_number=arguments.get("sdg_goal_number"),
                    indicator_names=arguments.get("indicator_names"),
                    year=arguments.get("year", 2021),
                    state_name=arguments.get("state_name")
                )
                return result
            
            elif function_name == "get_district_indicator_selection_prompt":
                result = get_district_indicator_selection_prompt(
                    district_name=arguments["district_name"],
                    sdg_goal_number=arguments["sdg_goal_number"]
                )
                return result
            
            elif function_name == "get_best_worst_district_for_indicator":
                result = get_best_worst_district_for_indicator(
                    sdg_goal_number=arguments.get("sdg_goal_number"),
                    indicator_name=arguments.get("indicator_name"),
                    query_type=arguments.get("query_type", "best"),
                    year=arguments.get("year", 2021),
                    state_name=arguments.get("state_name")
                )
                return result
            
            elif function_name == "get_aac_classification":
                result = get_aac_classification(
                    sdg_goal_number=arguments["sdg_goal_number"],
                    year=arguments.get("year", 2021),
                    state_name=arguments.get("state_name"),
                    classification_method=arguments.get("classification_method", "quantile"),
                    default_indicator=arguments.get("default_indicator")
                )
                return result
            
            # New high-priority functions
            elif function_name == "get_state_wise_summary":
                return get_state_wise_summary(**arguments)
            
            elif function_name == "get_time_series_comparison":
                return get_time_series_comparison(**arguments)
            
            elif function_name == "get_aspirational_district_tracking":
                return get_aspirational_district_tracking(**arguments)
            
            elif function_name == "get_cross_sdg_analysis":
                return get_cross_sdg_analysis(**arguments)
            
            elif function_name == "get_neighboring_districts_comparison":
                return get_neighboring_districts_comparison(**arguments)
            
            elif function_name == "get_state_wise_indicator_extremes":
                return get_state_wise_indicator_extremes(**arguments)
            
            # Add new function call for most/least improved districts
            elif function_name == "get_most_least_improved_districts":
                return get_most_least_improved_districts(
                    sdg_goal_number=arguments["sdg_goal_number"],
                    indicator_name=arguments.get("indicator_name"),
                    query_type=arguments.get("query_type", "most_improved"),
                    top_n=arguments.get("top_n", 5),
                    state_name=arguments.get("state_name")
                )
            
            # Add new function call for border districts
            elif function_name == "get_border_districts":
                return get_border_districts(
                    state1=arguments["state1"],
                    state2=arguments.get("state2"),
                    sdg_goal_number=arguments.get("sdg_goal_number"),
                    indicator_names=arguments.get("indicator_names"),
                    year=arguments.get("year", 2021),
                    include_boundary_data=arguments.get("include_boundary_data", True)
                )
            
            # Add new function call for districts within radius
            elif function_name == "get_districts_within_radius":
                return get_districts_within_radius(
                    center_point=arguments["center_point"],
                    radius_km=arguments["radius_km"],
                    sdg_goal_number=arguments.get("sdg_goal_number"),
                    indicator_names=arguments.get("indicator_names"),
                    max_districts=arguments.get("max_districts", 50),
                    include_boundary_data=arguments.get("include_boundary_data", True)
                )
            
            else:
                return {"error": f"Unknown function: {function_name}"}

        # Initial call to OpenAI
        response = client.chat.completions.create(
            model="gpt-4o-2024-08-06",
            messages=session["history"],
            tools=[
                {
                    "type": "function",
                    "function": {
                        "name": "get_indicators_by_sdg_goal",
                        "description": "Get all available indicators for a specific SDG goal number. Use this when user mentions an SDG goal number but doesn't specify which indicators they want to analyze. EXCEPTION: Do NOT use this for SDG Goals 8 and 17 (they have only 1 indicator each) - use get_sdg_goal_data directly instead.",
                        "parameters": {
                            "type": "object",
                            "properties": {
                                "sdg_goal_number": {
                                    "type": "integer",
                                    "description": "SDG goal number (1-17), but NOT 8 or 17"
                                }
                            },
                            "required": ["sdg_goal_number"]
                        }
                    }
                },
                {
                    "type": "function",
                    "function": {
                        "name": "get_sdg_goal_data",
                        "description": """Analyze SDG goal performance for Indian districts. Use this for detailed performance analysis.
                        
                        IMPORTANT: 
                        - For SDG Goals 8 and 17: Use this DIRECTLY since they have only 1 indicator each (no need to show indicators first)
                        - For other SDG goals: If user mentions SDG goal but no specific indicators, first call get_indicators_by_sdg_goal to show available indicators
                        
                        QUERY TYPES:
                        - 'individual': Get data for specific district(s) - use when user asks about specific district
                        - 'top_performers': Show top N districts with best performance (lowest values) - use for "best", "top", "highest performing"
                        - 'bottom_performers': Show bottom N districts with worst performance (highest values) - use for "worst", "bottom", "poorest performing"
                        - 'trend': Show both top and bottom N districts for comparison - use for "compare", "trends", "both"
                        
                        EXAMPLES:
                        - "Best districts for SDG 1" → First call get_indicators_by_sdg_goal(1), then get_sdg_goal_data
                        - "Best districts for SDG 8" → DIRECTLY call get_sdg_goal_data(8) since SDG 8 has only 1 indicator
                        - "Best districts for SDG 17" → DIRECTLY call get_sdg_goal_data(17) since SDG 17 has only 1 indicator
                        - "Worst performing districts SDG 3" → query_type='bottom_performers', top_n=5  
                        - "SDG 2 trends" → query_type='trend', top_n=5
                        - "Mumbai SDG 4 data" → query_type='individual', district_name='Mumbai'
                        - "Top 10 districts in Karnataka for SDG 5" → query_type='top_performers', top_n=10, state_name='Karnataka'
                        """,
                        "parameters": {
                            "type": "object",
                            "properties": {
                                "sdg_goal_number": {
                                    "type": "integer",
                                    "description": "SDG goal number (1-17)"
                                },
                                "indicator_names": {
                                    "type": "array",
                                    "items": {"type": "string"},
                                    "description": "List of specific indicator names. If not provided, uses all indicators for the SDG goal."
                                },
                                "year": {
                                    "type": "integer",
                                    "description": "Year for analysis (2016 or 2021)",
                                    "enum": [2016, 2021]
                                },
                                "query_type": {
                                    "type": "string",
                                    "enum": ["individual", "top_performers", "bottom_performers", "trend"],
                                    "description": "Type of analysis to perform"
                                },
                                "top_n": {
                                    "type": "integer",
                                    "description": "Number of districts to return (1-20)",
                                    "minimum": 1,
                                    "maximum": 20
                                },
                                "district_name": {
                                    "type": "string",
                                    "description": "Specific district name for individual queries"
                                },
                                "state_name": {
                                    "type": "string",
                                    "description": "Optional state filter"
                                },
                                "include_labels": {
                                    "type": "boolean",
                                    "description": "Include descriptive labels (default: true)"
                                }
                            },
                            "required": ["sdg_goal_number"]
                        }
                    }
                },
                {
                    "type": "function",
                    "function": {
                        "name": "get_sdg_goal_classification",
                        "description": """Get comprehensive SDG goal classification data for all indicators within the goal. This function provides all indicator data at once, allowing frontend to show classification for any indicator with dropdown selection.
                        
                        Use this when user wants to:
                        - "Classify districts for SDG Goal [number]"
                        - "Show SDG Goal [number] classification"
                        - "District classification for SDG [number]"
                        - "Map districts by SDG Goal [number]"
                        
                        This function:
                        - Returns ALL indicators for the SDG goal
                        - Provides district classification data for all indicators
                        - Uses SDG status classification by default (Achiever, Front Runner, Performer, Aspirant)
                        - Includes complete boundary data for visualization
                        - Supports state-wise filtering
                        
                        EXAMPLES:
                        - "Classify districts for SDG Goal 3" → Shows all SDG 3 indicators with dropdown selection
                        - "SDG 1 classification for Karnataka" → state_name='Karnataka'
                        - "District classification for SDG Goal 5" → All SDG 5 indicators available for selection
                        """,
                        "parameters": {
                            "type": "object",
                            "properties": {
                                "sdg_goal_number": {
                                    "type": "integer",
                                    "description": "SDG goal number (1-17)"
                                },
                                "year": {
                                    "type": "integer",
                                    "description": "Year for analysis (2016 or 2021)",
                                    "enum": [2016, 2021]
                                },
                                "state_name": {
                                    "type": "string",
                                    "description": "Optional state filter (None for all India)"
                                },
                                "classification_type": {
                                    "type": "string",
                                    "enum": ["status", "performance", "aspirational"],
                                    "description": "Type of classification to apply. 'status' uses SDG achievement status (default)"
                                },
                                "default_indicator": {
                                    "type": "string",
                                    "description": "Which indicator to show first (optional, uses first available if not specified)"
                                }
                            },
                            "required": ["sdg_goal_number"]
                        }
                    }
                },
                {
                    "type": "function",
                    "function": {
                        "name": "get_individual_district_sdg_data",
                        "description": """Get comprehensive SDG data for a specific district. Use this when user asks about a specific district by name.
                        
                        Use this when user mentions a specific district:
                        - "Tell me about Mumbai's SDG performance"
                        - "What is Delhi's SDG Goal 3 status?"
                        - "Show me Chennai's health indicators"
                        - "How is Bangalore performing on SDG 1?"
                        
                        This function:
                        - Automatically detects and resolves district names using fuzzy matching
                        - Returns NFHS-4, NFHS-5, and annual change values for all requested indicators
                        - Can analyze specific SDG goals or all goals for the district
                        - Provides trend analysis and improvement status
                        - Includes boundary data for map visualization
                        
                        WORKFLOW:
                        - If no SDG goal specified: Returns all available SDG data for the district
                        - If SDG goal specified but no indicators: Returns all indicators for that goal
                        - If specific indicators mentioned: Returns data for those indicators only
                        
                        EXAMPLES:
                        - "Mumbai SDG status" → All SDG goals for Mumbai
                        - "Delhi SDG Goal 3" → All SDG 3 indicators for Delhi
                        - "Chennai malnutrition rates" → Specific indicators for Chennai
                        """,
                        "parameters": {
                            "type": "object",
                            "properties": {
                                "district_name": {
                                    "type": "string",
                                    "description": "Name of the district (will be resolved using fuzzy matching)"
                                },
                                "sdg_goal_number": {
                                    "type": "integer",
                                    "description": "Optional SDG goal number (1-17). If not provided, returns all goals."
                                },
                                "indicator_names": {
                                    "type": "array",
                                    "items": {"type": "string"},
                                    "description": "Optional list of specific indicator names. If not provided, returns all indicators for the goal/district."
                                },
                                "year": {
                                    "type": "integer",
                                    "description": "Year for analysis (2016 or 2021)",
                                    "enum": [2016, 2021]
                                },
                                "state_name": {
                                    "type": "string",
                                    "description": "Optional state name for validation"
                                }
                            },
                            "required": ["district_name"]
                        }
                    }
                },
                {
                    "type": "function",
                    "function": {
                        "name": "get_district_indicator_selection_prompt",
                        "description": """Generate a selection prompt when user asks about a district and SDG goal but doesn't specify indicators.
                        
                        Use this when:
                        - User mentions district + SDG goal but no specific indicators
                        - You need to show available indicators for user selection
                        - User asks "What indicators are available for [district] in SDG [goal]?"
                        
                        This will return a list of available indicators with data availability status.
                        
                        EXAMPLES:
                        - "Mumbai SDG Goal 1" (no specific indicators) → Show available SDG 1 indicators for Mumbai
                        - "What SDG 3 indicators are available for Delhi?" → List SDG 3 indicators
                        """,
                        "parameters": {
                            "type": "object",
                            "properties": {
                                "district_name": {
                                    "type": "string",
                                    "description": "Name of the district"
                                },
                                "sdg_goal_number": {
                                    "type": "integer",
                                    "description": "SDG goal number (1-17)"
                                }
                            },
                            "required": ["district_name", "sdg_goal_number"]
                        }
                    }
                },
                {
                    "type": "function",
                    "function": {
                        "name": "get_best_worst_district_for_indicator",
                        "description": """Find the best or worst performing district for a specific SDG goal or indicator.
                        
                        Use this when user asks:
                        - "Which district performs best on SDG Goal 3?"
                        - "What is the worst performing district for malnutrition?"
                        - "Best district for maternal mortality rate"
                        - "Worst performing district in Karnataka for SDG 1"
                        
                        This function:
                        - Finds single best/worst performing district
                        - Returns NFHS-4, NFHS-5, and annual change values
                        - Handles both specific indicators and overall SDG goal performance
                        - Supports state-wise filtering
                        - Provides proper ranking based on indicator direction (higher/lower is better)
                        
                        EXAMPLES:
                        - "Best district for SDG Goal 1" → Overall best performing district for SDG 1
                        - "Worst district for child mortality" → Worst performing district for specific indicator
                        - "Best performing district in Maharashtra for SDG 3" → State-filtered query
                        """,
                        "parameters": {
                            "type": "object",
                            "properties": {
                                "sdg_goal_number": {
                                    "type": "integer",
                                    "description": "SDG goal number (1-17). Required for overall goal performance."
                                },
                                "indicator_name": {
                                    "type": "string",
                                    "description": "Specific indicator name (optional). If provided, finds best/worst for this indicator."
                                },
                                "query_type": {
                                    "type": "string",
                                    "enum": ["best", "worst"],
                                    "description": "Whether to find best or worst performing district"
                                },
                                "year": {
                                    "type": "integer",
                                    "description": "Year for analysis (2016 or 2021)",
                                    "enum": [2016, 2021]
                                },
                                "state_name": {
                                    "type": "string",
                                    "description": "Optional state filter"
                                }
                            },
                            "required": ["query_type"]
                        }
                    }
                },
                {
                    "type": "function",
                    "function": {
                        "name": "get_aac_classification",
                        "description": "Classify districts based on Annual Average Change (AAC) values to understand improvement trends. Use this when users ask about districts improving/declining over time, progress trends, or want to see which districts are making rapid progress vs those declining.",
                        "parameters": {
                            "type": "object",
                            "properties": {
                                "sdg_goal_number": {"type": "integer", "description": "SDG goal number (1-17)"},
                                "year": {"type": "integer", "description": "Year for analysis (2021 or 2016)", "default": 2021},
                                "state_name": {"type": "string", "description": "Optional state name to filter results"},
                                "classification_method": {"type": "string", "enum": ["quantile", "natural_breaks"], "description": "Classification method", "default": "quantile"},
                                "default_indicator": {"type": "string", "description": "Optional specific indicator name"}
                            },
                            "required": ["sdg_goal_number"]
                        }
                    }
                },
                {
                    "type": "function",
                    "function": {
                        "name": "get_state_wise_summary",
                        "description": "Get state-level aggregated SDG performance summary with district boundary data for mapping. Use this when users ask about state-level performance, which states are doing best/worst, state comparisons, or want to see performance patterns at state level rather than district level. Returns boundary data for visualization.",
                        "parameters": {
                            "type": "object",
                            "properties": {
                                "sdg_goal_number": {"type": "integer", "description": "Optional SDG goal number (1-17)"},
                                "indicator_names": {"type": "array", "items": {"type": "string"}, "description": "Optional list of specific indicator names"},
                                "year": {"type": "integer", "description": "Year for analysis (2021 or 2016)", "default": 2021},
                                "top_n": {"type": "integer", "description": "Number of states to return", "default": 10},
                                "sort_by": {"type": "string", "enum": ["average_performance", "improvement_rate", "district_count"], "description": "How to sort states", "default": "average_performance"}
                            },
                            "required": []
                        }
                    }
                },
                {
                    "type": "function",
                    "function": {
                        "name": "get_time_series_comparison",
                        "description": "Analyze changes between NFHS-4 (2016) and NFHS-5 (2021) data to show trends over time with boundary data for mapping. Use this when users ask about progress over time, trend analysis, which districts improved most, comparing 2016 vs 2021 data, or tracking changes. Returns boundary data for visualization.",
                        "parameters": {
                            "type": "object",
                            "properties": {
                                "sdg_goal_number": {"type": "integer", "description": "Optional SDG goal number (1-17)"},
                                "indicator_names": {"type": "array", "items": {"type": "string"}, "description": "Optional list of specific indicator names"},
                                "analysis_type": {"type": "string", "enum": ["district_trends", "state_trends", "top_improvers", "top_decliners"], "description": "Type of time series analysis", "default": "district_trends"},
                                "top_n": {"type": "integer", "description": "Number of entities to return", "default": 10},
                                "state_name": {"type": "string", "description": "Optional state name to filter results"}
                            },
                            "required": []
                        }
                    }
                },
                {
                    "type": "function",
                    "function": {
                        "name": "get_aspirational_district_tracking",
                        "description": "Track and analyze performance of aspirational districts specifically with boundary data for mapping. Use this when users ask about aspirational districts, how they're performing, which ones are improving fastest, or need attention for policy intervention. Returns boundary data for visualization.",
                        "parameters": {
                            "type": "object",
                            "properties": {
                                "sdg_goal_number": {"type": "integer", "description": "Optional SDG goal number (1-17)"},
                                "indicator_names": {"type": "array", "items": {"type": "string"}, "description": "Optional list of specific indicator names"},
                                "analysis_type": {"type": "string", "enum": ["performance_summary", "top_performers", "most_improved", "needs_attention"], "description": "Type of aspirational district analysis", "default": "performance_summary"},
                                "year": {"type": "integer", "description": "Year for analysis (2021 or 2016)", "default": 2021},
                                "top_n": {"type": "integer", "description": "Number of districts to return", "default": 15},
                                "state_name": {"type": "string", "description": "Optional state name to filter results"}
                            },
                            "required": []
                        }
                    }
                },
                {
                    "type": "function",
                    "function": {
                        "name": "get_cross_sdg_analysis",
                        "description": "Analyze relationships and patterns across multiple SDG goals to understand holistic development with boundary data for mapping. Use this when users ask about: correlations between different SDG goals, districts performing well/badly across multiple SDG goals, best and worst performers across multiple SDGs, multi-goal performance analysis, cross-SDG comparisons, districts excelling in several goals simultaneously, synergies and trade-offs between goals, or understanding interconnections between different development areas. Always use this function when the query mentions multiple SDG goals together (e.g., 'SDG 1, 3, and 5'). All analysis types are fully functional. Returns boundary data for visualization.",
                        "parameters": {
                            "type": "object",
                            "properties": {
                                "sdg_goals": {"type": "array", "items": {"type": "integer"}, "description": "List of SDG goal numbers to analyze (minimum 2 goals)"},
                                "analysis_type": {"type": "string", "enum": ["correlation", "multi_goal_performance", "goal_synergies", "best_worst_performers"], "description": "Type of cross-SDG analysis: 'correlation' for analyzing relationships between goals, 'multi_goal_performance' for districts performing across multiple goals, 'goal_synergies' for identifying synergies and trade-offs, 'best_worst_performers' for top/bottom performers across goals", "default": "correlation"},
                                "year": {"type": "integer", "description": "Year for analysis (2021 or 2016)", "default": 2021},
                                "top_n": {"type": "integer", "description": "Number of results to return", "default": 10},
                                "state_name": {"type": "string", "description": "Optional state name to filter results"}
                            },
                            "required": ["sdg_goals"]
                        }
                    }
                },
                {
                    "type": "function",
                    "function": {
                        "name": "get_neighboring_districts_comparison",
                        "description": "Compare a district's SDG performance with its neighboring districts using spatial analysis. Use this when users ask about how a district compares to nearby districts, neighboring performance, or spatial comparisons. Examples: 'How is Mumbai performing compared to neighboring districts?', 'Compare Delhi with nearby districts for SDG 3', 'How do neighboring districts perform for malnutrition compared to Chennai?'. Returns boundary data for mapping all districts.",
                        "parameters": {
                            "type": "object",
                            "properties": {
                                "district_name": {"type": "string", "description": "Target district name to compare with neighbors"},
                                "sdg_goal_number": {"type": "integer", "description": "Optional SDG goal number (1-17) for focused analysis"},
                                "indicator_names": {"type": "array", "items": {"type": "string"}, "description": "Optional list of specific indicator names"},
                                "year": {"type": "integer", "description": "Year for analysis (2021 or 2016)", "default": 2021},
                                "neighbor_method": {"type": "string", "enum": ["distance", "touching", "closest"], "description": "Method to identify neighbors: 'distance' for within specified km, 'touching' for shared boundary, 'closest' for nearest by centroid", "default": "distance"},
                                "max_distance_km": {"type": "number", "description": "Maximum distance in km for neighbors (used with 'distance' method)", "default": 100.0},
                                "max_neighbors": {"type": "integer", "description": "Maximum number of neighbors to include", "default": 10}
                            },
                            "required": ["district_name"]
                        }
                    }
                },
                {
                    "type": "function",
                    "function": {
                        "name": "get_state_wise_indicator_extremes",
                        "description": "Get the best and worst performing districts for a specific indicator in every state. Use this when users ask about state-wise best/worst performers for specific indicators, intra-state comparisons, or want to see which districts lead/lag within each state. Examples: 'Show me the best and worst districts for skilled birth attendance in each state', 'Which districts have the highest and lowest malnutrition rates in every state?', 'State-wise top and bottom performers for vaccination coverage'. Uses actual NFHS values and considers higher_is_better logic.",
                        "parameters": {
                            "type": "object",
                            "properties": {
                                "indicator_name": {"type": "string", "description": "Short name of the indicator (e.g., 'Skilled Birth Attendants', 'Under 5 Mortality')"},
                                "year": {"type": "integer", "description": "Year for analysis (2021 or 2016)", "default": 2021},
                                "include_aac": {"type": "boolean", "description": "Whether to include annual average change analysis in results", "default": 'true'},
                                "min_districts_per_state": {"type": "integer", "description": "Minimum number of districts required per state to include in results", "default": 3}
                            },
                            "required": ["indicator_name"]
                        }
                    }
                },
                {
                    "type": "function",
                    "function": {
                        "name": "get_most_least_improved_districts",
                        "description": "Get districts with the most or least improvement (annual change) for a given SDG goal or indicator. Use this when users ask: 'Which districts have improved the most in SDG 2 since 2016?' or 'Show districts with the biggest decline in SDG 4.' Supports filtering by indicator and state. Returns top N improved or declined districts, with boundary data for mapping.",
                        "parameters": {
                            "type": "object",
                            "properties": {
                                "sdg_goal_number": {
                                    "type": "integer",
                                    "description": "SDG goal number (1-17)"
                                },
                                "indicator_name": {
                                    "type": "string",
                                    "description": "Optional specific indicator name (if not provided, uses all indicators for the goal)"
                                },
                                "query_type": {
                                    "type": "string",
                                    "enum": ["most_improved", "least_improved"],
                                    "description": "Whether to return most improved or least improved districts"
                                },
                                "top_n": {
                                    "type": "integer",
                                    "description": "Number of districts to return (default 5)",
                                    "minimum": 1,
                                    "maximum": 20
                                },
                                "state_name": {
                                    "type": "string",
                                    "description": "Optional state filter"
                                }
                            },
                            "required": ["sdg_goal_number"]
                        }
                    }
                },
                {
                    "type": "function",
                    "function": {
                        "name": "get_border_districts",
                        "description": """Find districts that share borders with a specific state and analyze their SDG performance. Use this when users ask about border districts, inter-state comparisons, or districts at state boundaries.
                        
                        IMPORTANT: For multiple separate states (e.g., "border districts of Bihar and Goa"), make SEPARATE function calls for each state.
                        
                        Examples:
                        - "Show districts on the border of Maharashtra" → One call with state1="Maharashtra"
                        - "Border districts of Bihar and Goa with SDG 1" → TWO calls: state1="Bihar" and state1="Goa"
                        - "Districts at Gujarat border with SDG 1 performance" → One call with state1="Gujarat"
                        - "Border districts between Karnataka and Tamil Nadu" → One call with state1="Karnataka" (will show Tamil Nadu districts that border Karnataka)
                        
                        Features:
                        - Identifies districts that physically share borders with the target state using spatial analysis
                        - Returns districts from OTHER states that border the target state (excludes districts within target state)
                        - Returns comprehensive SDG data for all border districts
                        - Supports filtering by specific SDG goals or indicators
                        - Includes boundary geometry data for mapping
                        - Provides comparative analysis between neighboring states
                        
                        Use Cases:
                        - Inter-state policy coordination analysis
                        - Cross-border development patterns
                        - Regional disparities at state boundaries
                        - Resource sharing opportunities between neighboring states
                        """,
                        "parameters": {
                            "type": "object",
                            "properties": {
                                "state1": {
                                    "type": "string",
                                    "description": "First state name (required). Example: 'Maharashtra', 'Karnataka'"
                                },
                                "state2": {
                                    "type": "string",
                                    "description": "Second state name (optional). If not provided, finds all border districts of state1 with neighboring states."
                                },
                                "sdg_goal_number": {
                                    "type": "integer",
                                    "description": "Optional SDG goal number (1-17) for focused analysis"
                                },
                                "indicator_names": {
                                    "type": "array",
                                    "items": {"type": "string"},
                                    "description": "Optional list of specific indicator names. If not provided, returns all indicators for the specified SDG goal."
                                },
                                "year": {
                                    "type": "integer",
                                    "description": "Year for analysis (2016 or 2021)",
                                    "enum": [2016, 2021]
                                },
                                "include_boundary_data": {
                                    "type": "boolean",
                                    "description": "Whether to include boundary geometry data for mapping (default: true)"
                                }
                            },
                            "required": ["state1"]
                        }
                    }
                },
                {
                    "type": "function",
                    "function": {
                        "name": "get_districts_within_radius",
                        "description": """Find all districts within a specified radius from a center point and analyze their SDG performance. Use this when users ask about districts within a specific distance, nearby areas, or radius-based analysis.
                        
                        Features:
                        - Accepts either district name or coordinates (lat,lng) as center point
                        - Finds all districts within specified radius using spatial analysis
                        - Returns comprehensive SDG data with both 2016 and 2021 values plus AAC (Annual Average Change)
                        - Supports both SDG goal analysis and specific indicator analysis
                        - Includes distance information for each district from the center point
                        - Provides boundary geometry data for mapping
                        - Generates detailed comparative analysis with improvement trends
                        
                        Center Point Formats:
                        - District name: "Delhi", "Mumbai", "Chennai"
                        - Coordinates: "28.6139,77.2090" (lat,lng format)
                        
                        Examples:
                        - "List all districts within 100 km of Delhi and their SDG 7 performance"
                        - "Districts within 50 km of Mumbai with health indicators"
                        - "Find districts within 200 km of coordinates 22.5726,88.3639 for education data"
                        - "Show poverty levels in districts within 150 km of Bangalore"
                        
                        Use Cases:
                        - Regional development planning
                        - Resource allocation for nearby areas
                        - Spatial pattern analysis
                        - Identifying clusters of high/low performance
                        - Cross-district collaboration opportunities
                        """,
                        "parameters": {
                            "type": "object",
                            "properties": {
                                "center_point": {
                                    "type": "string",
                                    "description": "Either a district name (e.g., 'Delhi') or coordinates as 'lat,lng' (e.g., '28.6139,77.2090')"
                                },
                                "radius_km": {
                                    "type": "number",
                                    "description": "Radius in kilometers to search within",
                                    "minimum": 1,
                                    "maximum": 1000
                                },
                                "sdg_goal_number": {
                                    "type": "integer",
                                    "description": "Optional SDG goal number (1-17) for focused analysis"
                                },
                                "indicator_names": {
                                    "type": "array",
                                    "items": {"type": "string"},
                                    "description": "Optional list of specific indicator names. If not provided with SDG goal, returns all indicators for that goal."
                                },
                                "max_districts": {
                                    "type": "integer",
                                    "description": "Maximum number of districts to return (default: 50)",
                                    "minimum": 5,
                                    "maximum": 100
                                },
                                "include_boundary_data": {
                                    "type": "boolean",
                                    "description": "Whether to include boundary geometry data for mapping (default: true)"
                                }
                            },
                            "required": ["center_point", "radius_km"]
                        }
                    }
                }
            ]
        )

        # Handle the response
        if response.choices[0].message.tool_calls:
            # Function calls were made
            function_results = []
            all_boundaries = []

            # Execute function calls
            for tool_call in response.choices[0].message.tool_calls:
                function_name = tool_call.function.name
                arguments = json.loads(tool_call.function.arguments)
                
                print(f"Executing function: {function_name}")
                print(f"Arguments: {arguments}")
                
                result = execute_function_call(function_name, arguments)
                
                # Collect boundaries if present (check both old and new field names)
                if isinstance(result, dict):
                    boundaries = result.get("boundary") or result.get("boundary_data")
                    if boundaries:
                        if isinstance(boundaries, list):
                            all_boundaries.extend(boundaries)
                        else:
                            all_boundaries.append(boundaries)
                
                function_results.append({
                    "function": function_name,
                    "arguments": arguments,
                    "result": result
                })

            # Create function call messages for OpenAI
            messages_with_results = session["history"] + [response.choices[0].message]
            
            # Add function call results
            for i, tool_call in enumerate(response.choices[0].message.tool_calls):
                function_result = function_results[i]["result"]
                
                # Clean result for OpenAI (remove large fields but preserve enhanced_analysis)
                clean_result = dict(function_result) if isinstance(function_result, dict) else function_result
                if isinstance(clean_result, dict):
                    # Remove boundary data but KEEP enhanced_analysis for comprehensive responses
                    clean_result.pop("boundary", None)
                    clean_result.pop("boundary_data", None)
                    
                    # For trend queries, preserve the enhanced_analysis but summarize data arrays
                    if clean_result.get("query_type") == "trend" and "enhanced_analysis" in clean_result:
                        # For trend analysis, prioritize the enhanced_analysis field
                        # Keep a summary of the data but preserve the comprehensive analysis text
                        if "data" in clean_result and isinstance(clean_result["data"], dict):
                            data_obj = clean_result["data"]
                            if "top_performers" in data_obj and "bottom_performers" in data_obj:
                                # Create a summary instead of truncating
                                top_summary = [{"district": d.get("district"), "state": d.get("state"), 
                                               "performance": d.get("performance_percentile"), 
                                               "annual_change": d.get("annual_change")} 
                                              for d in data_obj["top_performers"][:3]]
                                bottom_summary = [{"district": d.get("district"), "state": d.get("state"), 
                                                  "performance": d.get("performance_percentile"), 
                                                  "annual_change": d.get("annual_change")} 
                                                 for d in data_obj["bottom_performers"][:3]]
                                clean_result["data_summary"] = {
                                    "top_performers": top_summary,
                                    "bottom_performers": bottom_summary,
                                    "total_top": len(data_obj["top_performers"]),
                                    "total_bottom": len(data_obj["bottom_performers"])
                                }
                                # Remove the full data arrays to save tokens
                                clean_result.pop("data", None)
                    else:
                        # For non-trend queries, limit data arrays as before
                        if "data" in clean_result:
                            data_obj = clean_result["data"]
                            if isinstance(data_obj, list) and len(data_obj) > 10:
                                clean_result["data"] = data_obj[:10]
                                clean_result["data_summary"] = f"Showing first 10 of {len(data_obj)} total districts"
                
                # Convert to string with special handling for enhanced_analysis
                if isinstance(clean_result, dict) and "enhanced_analysis" in clean_result:
                    # For responses with enhanced_analysis, ensure it's prominently featured
                    enhanced_analysis = clean_result["enhanced_analysis"]
                    result_str = f"ENHANCED_ANALYSIS: {enhanced_analysis}\n\nOTHER_DATA: {json.dumps({k: v for k, v in clean_result.items() if k != 'enhanced_analysis'}, default=str)}"
                else:
                    result_str = json.dumps(clean_result, default=str)
                
                # More generous token limit for enhanced analysis
                if len(result_str) > 4000:
                    if "ENHANCED_ANALYSIS:" in result_str:
                        # Preserve enhanced analysis but truncate other data
                        parts = result_str.split("OTHER_DATA:", 1)
                        if len(parts) == 2:
                            enhanced_part = parts[0]
                            other_part = parts[1][:1000] + "... [Other data truncated]"
                            result_str = enhanced_part + "OTHER_DATA:" + other_part
                    else:
                        result_str = result_str[:3800] + "... [Result truncated for token limit]"
                
                messages_with_results.append({
                    "role": "tool",
                    "tool_call_id": tool_call.id,
                    "content": result_str
                })

            # Get synthesized response from OpenAI
            synthesis_response = client.chat.completions.create(
                model="gpt-4o-2024-08-06",
                messages=messages_with_results
            )

            final_response = synthesis_response.choices[0].message.content
            
            # Create truncated version for history
            truncated_response = final_response
            if len(final_response) > 2500:
                truncated_response = final_response[:2000] + "... [Response truncated for conversation history]"
            
            # Add to history with proper token management
            assistant_message = {"role": "assistant", "content": truncated_response}
            session["history"] = manage_conversation_history(session["history"], assistant_message)

            # Determine map type
            map_type = "sdg_analysis"
            if len(function_results) == 1:
                single_result = function_results[0]["result"]
                if isinstance(single_result, dict):
                    map_type = single_result.get("map_type", "sdg_analysis")
                else:
                    map_type = "sdg_analysis"

            # Return comprehensive response
            return {
                "response": final_response,
                "map_type": map_type,
                "function_calls": [{"function": fr["function"], "arguments": fr["arguments"]} for fr in function_results],
                "data": function_results,
                "boundary": all_boundaries
            }

        else:
            # No function calls - just return conversational response
            final_response = response.choices[0].message.content
            
            # Add to history
            assistant_message = {"role": "assistant", "content": final_response}
            session["history"] = manage_conversation_history(session["history"], assistant_message)
            return {"response": final_response}

    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="Invalid JSON format")
    except OpenAIError as e:
        raise HTTPException(status_code=500, detail=f"OpenAI API error: {str(e)}")
    except psycopg2.Error as e:
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Unexpected error: {str(e)}")

@app.post("/most_least_improved_districts/")
async def most_least_improved_districts(request: MostLeastImprovedRequest):
    try:
        result = get_most_least_improved_districts(
            sdg_goal_number=request.sdg_goal_number,
            indicator_name=request.indicator_name,
            query_type=request.query_type,
            top_n=request.top_n,
            state_name=request.state_name
        )
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error: {str(e)}") 
