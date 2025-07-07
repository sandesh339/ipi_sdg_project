import psycopg2
import pandas as pd
import numpy as np
import json
from typing import List, Dict, Any, Optional
from rapidfuzz import process, fuzz
import re

def get_db_connection():
    """Get database connection for SDG database"""
    return psycopg2.connect(
        dbname='sdgquery',
        user='postgres',
        password='Happy123-',
        host='localhost',
        port='5432'
    )

def get_indicators_by_sdg_goal(sdg_goal_number: int):
    """
    Get all available indicators for a specific SDG goal number.
    """
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        
        # Query to get all indicators for the SDG goal
        query = """
        SELECT 
            sdg_short_indicator_name,
            sdg_full_indicator_name,
            sdg_indicator_number
        FROM SDG_Goals 
        WHERE major_sdg_goal = %s
        ORDER BY sdg_indicator_number
        """
        
        cursor.execute(query, (sdg_goal_number,))
        results = cursor.fetchall()
        
        if not results:
            return {
                "message": f"No indicators found for SDG Goal {sdg_goal_number}",
                "indicators": [],
                "sdg_goal": sdg_goal_number
            }
        
        indicators = []
        for row in results:
            indicators.append({
                "short_name": row[0],
                "full_name": row[1],
                "indicator_number": row[2]
            })
        
        cursor.close()
        conn.close()
        
        return {
            "message": f"Found {len(indicators)} indicators for SDG Goal {sdg_goal_number}",
            "indicators": indicators,
            "sdg_goal": sdg_goal_number,
            "count": len(indicators)
        }
        
    except Exception as e:
        return {"error": f"Error retrieving indicators: {str(e)}"}

def fuzzy_match_indicator(user_input: str, sdg_goal_number: int = None):
    """
    Find best matching indicator using fuzzy matching.
    """
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        
        # Get all indicators for the SDG goal or all indicators if no goal specified
        if sdg_goal_number:
            query = """
            SELECT sdg_short_indicator_name, sdg_full_indicator_name 
            FROM SDG_Goals 
            WHERE major_sdg_goal = %s
            """
            cursor.execute(query, (sdg_goal_number,))
        else:
            query = """
            SELECT sdg_short_indicator_name, sdg_full_indicator_name 
            FROM SDG_Goals
            """
            cursor.execute(query)
        
        results = cursor.fetchall()
        
        # Create list of all possible indicator names
        all_indicators = []
        for row in results:
            all_indicators.append(row[0])  # short name
            all_indicators.append(row[1])  # full name
        
        # Find best match
        best_match = process.extractOne(user_input, all_indicators, score_cutoff=60)
        
        cursor.close()
        conn.close()
        
        if best_match:
            return best_match[0]
        return None
        
    except Exception as e:
        print(f"Error in fuzzy matching: {e}")
        return None

def normalize_district_name(name):
    return name.upper().strip() if name else name

def get_district_boundary_data(district_names: List[str]):
    """
    Get boundary data for specified districts from District_Geometry table.
    """
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        
        if not district_names:
            return []
        
        # Normalize district names to match database format (uppercase and trimmed)
        normalized_names = [normalize_district_name(name) for name in district_names]
        
        # Create placeholder string for IN clause
        placeholders = ','.join(['%s'] * len(normalized_names))
        
        query = f"""
        SELECT 
            district_name,
            state_name,
            ST_AsGeoJSON(geom) as geometry,
            area_sqkm,
            perimeter_km
        FROM District_Geometry 
        WHERE UPPER(TRIM(district_name)) IN ({placeholders})
        """
        
        cursor.execute(query, normalized_names)
        results = cursor.fetchall()
        
        boundaries = []
        for row in results:
            boundaries.append({
                "district": row[0],
                "state": row[1],
                "geometry": json.loads(row[2]) if row[2] else None,
                "area_sqkm": float(row[3]) if row[3] else None,
                "perimeter_km": float(row[4]) if row[4] else None
            })
        
        cursor.close()
        conn.close()
        
        return boundaries
        
    except Exception as e:
        print(f"Error getting boundary data: {e}")
        return []

def get_sdg_goal_data(
    sdg_goal_number: int,
    indicator_names: Optional[List[str]] = None,
    year: int = 2021,
    query_type: str = "individual",
    top_n: int = 5,
    district_name: Optional[str] = None,
    state_name: Optional[str] = None,
    include_labels: bool = True
):
    """
    Smart routing function that decides between specific indicator analysis or overall SDG goal analysis.
    
    - If a specific indicator is mentioned: Uses actual indicator values (get_specific_indicator_data)
    - If no specific indicator or multiple indicators: Uses percentile-based ranking (get_overall_sdg_goal_data)
    
    Parameters:
    - sdg_goal_number: SDG goal number (1-17)
    - indicator_names: List of specific indicators, if None uses all for the goal
    - year: 2016 or 2021
    - query_type: 'individual', 'top_performers', 'bottom_performers', 'trend'
    - top_n: Number of districts to return
    - district_name: Specific district for individual queries
    - state_name: Optional state filter
    - include_labels: Include descriptive labels
    """
    try:
        # Decision logic: Use specific indicator analysis if exactly one indicator is specified
        if indicator_names and len(indicator_names) == 1:
            # User asked about a specific indicator - use actual values
            return get_specific_indicator_data(
                sdg_goal_number=sdg_goal_number,
                indicator_name=indicator_names[0],
                year=year,
                query_type=query_type,
                top_n=top_n,
                state_name=state_name
            )
        else:
            # User asked about overall SDG goal or multiple indicators - use percentiles
            return get_overall_sdg_goal_data(
                sdg_goal_number=sdg_goal_number,
                year=year,
                query_type=query_type,
                top_n=top_n,
                district_name=district_name,
                state_name=state_name,
                include_labels=include_labels
            )
    
    except Exception as e:
        return {"error": f"Error in SDG goal data routing: {str(e)}"}

def get_individual_district_data(cursor, sdg_goal_number, indicator_names, year, district_name, state_name):
    """Get data for a specific district."""
    try:
        # Build district filter
        district_filter = "sgd.district_name ILIKE %s"
        params = [sdg_goal_number, year, f"%{district_name}%"]
        
        if state_name:
            district_filter += " AND ds.state_name ILIKE %s"
            params.append(f"%{state_name}%")
        
        # Create placeholder for indicators
        indicator_placeholders = ','.join(['%s'] * len(indicator_names))
        params.extend(indicator_names)
        
        query = f"""
        SELECT 
            sgd.district_name,
            ds.state_name,
            sg.sdg_short_indicator_name,
            sg.sdg_full_indicator_name,
            sgd.nfhs_value_4,
            sgd.nfhs_value_5,
            sgd.actual_annual_change,
            sgd.aspirational_status,
            sgd.district_sdg_status
        FROM SDG_Goals_Data sgd
        JOIN SDG_Goals sg ON sgd.sdg_short_indicator_name = sg.sdg_short_indicator_name
        JOIN District_State ds ON sgd.district_name = ds.district_name
        WHERE sg.major_sdg_goal = %s
        AND ({year}_column IS NOT NULL)
        AND {district_filter}
        AND sg.sdg_short_indicator_name IN ({indicator_placeholders})
        ORDER BY sgd.district_name, sg.sdg_indicator_number
        """.replace("{year}_column", f"sgd.nfhs_value_{year - 2015}")
        
        cursor.execute(query, params)
        results = cursor.fetchall()
        
        # Process results
        district_data = {}
        for row in results:
            district_key = f"{row[0]}, {row[1]}"
            if district_key not in district_data:
                district_data[district_key] = {
                    "district": row[0],
                    "state": row[1],
                    "indicators": [],
                    "aspirational_status": row[7],
                    "district_sdg_status": row[8]
                }
            
            # Get the appropriate year value
            current_value = row[5] if year == 2021 else row[4]
            
            district_data[district_key]["indicators"].append({
                "indicator_name": row[2],
                "indicator_full_name": row[3],
                "nfhs_4_value": float(row[4]) if row[4] is not None else None,
                "nfhs_5_value": float(row[5]) if row[5] is not None else None,
                "current_value": float(current_value) if current_value is not None else None,
                "annual_change": float(row[6]) if row[6] is not None else None
            })
        
        return {"data": list(district_data.values())}
        
    except Exception as e:
        return {"error": f"Error getting individual district data: {str(e)}"}

def get_top_performers_data(cursor, sdg_goal_number, indicator_names, year, top_n, state_name):
    """Get top performing districts for SDG goal using database metadata for proper ranking."""
    try:
        state_filter = ""
        params = [sdg_goal_number]
        
        if state_name:
            state_filter = "AND ds.state_name ILIKE %s"
            params.append(f"%{state_name}%")
        
        # Create placeholder for indicators
        indicator_placeholders = ','.join(['%s'] * len(indicator_names))
        params.extend(indicator_names)
        params.append(top_n)
        
        # Determine year column - NFHS-4 (2016) and NFHS-5 (2021)
        year_column = "sgd.nfhs_value_5" if year == 2021 else "sgd.nfhs_value_4"
        
        # Enhanced query that uses database metadata for proper ranking
        # Uses normalized scoring to handle mixed indicator directions
        query = f"""
        WITH indicator_percentiles AS (
            SELECT 
                sgd.district_name,
                ds.state_name,
                sg.sdg_short_indicator_name,
                {year_column} as value,
                COALESCE(sg.higher_is_better, FALSE) as higher_is_better,
                sgd.aspirational_status,
                sgd.district_sdg_status,
                CASE 
                    WHEN COALESCE(sg.higher_is_better, FALSE) = TRUE THEN 
                        PERCENT_RANK() OVER (PARTITION BY sg.sdg_short_indicator_name ORDER BY {year_column} ASC) * 100
                    ELSE 
                        PERCENT_RANK() OVER (PARTITION BY sg.sdg_short_indicator_name ORDER BY {year_column} DESC) * 100
                END as performance_score
            FROM SDG_Goals_Data sgd
            JOIN SDG_Goals sg ON sgd.sdg_short_indicator_name = sg.sdg_short_indicator_name
            JOIN District_State ds ON sgd.district_name = ds.district_name
            WHERE sg.major_sdg_goal = %s
            AND {year_column} IS NOT NULL
            {state_filter}
            AND sg.sdg_short_indicator_name IN ({indicator_placeholders})
        ),
        district_scores AS (
            SELECT 
                district_name,
                state_name,
                AVG(performance_score) as avg_performance_score,
                COUNT(*) as indicator_count,
                MAX(aspirational_status) as aspirational_status,
                STRING_AGG(DISTINCT district_sdg_status, ', ' ORDER BY district_sdg_status) as district_sdg_status
            FROM indicator_percentiles
            GROUP BY district_name, state_name
        )
        SELECT 
            district_name,
            state_name,
            avg_performance_score as avg_score,
            indicator_count,
            aspirational_status,
            district_sdg_status
        FROM district_scores
        WHERE indicator_count >= 2  -- Ensure we have at least 2 indicators for reliable ranking
        ORDER BY avg_performance_score DESC  -- Higher performance score is better
        LIMIT %s
        """
        
        cursor.execute(query, params)
        results = cursor.fetchall()
        
        # Get detailed indicator data for these districts
        if results:
            district_names = [row[0] for row in results]
            detailed_data = get_detailed_indicator_data(cursor, district_names, indicator_names, year)
        else:
            detailed_data = {}
        
        # Format results
        formatted_results = []
        for i, row in enumerate(results):
            district_indicators = detailed_data.get(row[0], [])
            primary_indicator = district_indicators[0] if district_indicators else {}
            
            # Calculate overall annual change across all indicators
            overall_annual_change, overall_change_interpretation = calculate_overall_annual_change(district_indicators)
            
            district_data = {
                "rank": i + 1,
                "district": row[0],
                "state": row[1],
                "performance_percentile": float(row[2]) if row[2] is not None else None,  # Renamed for clarity
                "indicators_available": int(row[3]),
                "aspirational_status": row[4],
                "district_sdg_status": row[5],
                "indicators": district_indicators,
                # Add clear primary values for consistent display
                "primary_indicator_value": primary_indicator.get("current_value"),
                "primary_indicator_name": primary_indicator.get("indicator_name"),
                # Use aggregated annual change for overall SDG performance
                "annual_change": overall_annual_change,
                "trend_status": overall_change_interpretation.get("interpretation") if isinstance(overall_change_interpretation, dict) else "unknown",
                "trend_description": overall_change_interpretation.get("description") if isinstance(overall_change_interpretation, dict) else "No trend data",
                "is_improving": overall_change_interpretation.get("is_improvement") if isinstance(overall_change_interpretation, dict) else None,
                # Add detailed overall trend analysis
                "overall_trend_analysis": overall_change_interpretation if isinstance(overall_change_interpretation, dict) else None,
                # Keep primary indicator for reference
                "primary_annual_change": primary_indicator.get("annual_change"),
                "primary_trend_status": primary_indicator.get("change_interpretation", {}).get("interpretation")
            }
            formatted_results.append(district_data)
        
        return {"data": formatted_results}
        
    except Exception as e:
        return {"error": f"Error getting top performers: {str(e)}"}

def get_bottom_performers_data(cursor, sdg_goal_number, indicator_names, year, top_n, state_name):
    """Get bottom performing districts for SDG goal using database metadata for proper ranking."""
    try:
        # Validate percentile calculations to detect potential data anomalies
        validation_results = validate_percentile_calculation(cursor, sdg_goal_number, indicator_names, year)
        
        # Log any anomalies detected
        for indicator, validation in validation_results.items():
            if validation.get("anomalies"):
                print(f"⚠️  Data anomalies detected for {indicator}: {validation['anomalies']}")
                print(f"   Stats: min={validation['min_value']:.2f}, max={validation['max_value']:.2f}, avg={validation['avg_value']:.2f}")
        
        state_filter = ""
        params = [sdg_goal_number]
        
        if state_name:
            state_filter = "AND ds.state_name ILIKE %s"
            params.append(f"%{state_name}%")
        
        indicator_placeholders = ','.join(['%s'] * len(indicator_names))
        params.extend(indicator_names)
        params.append(top_n)
        
        # Determine year column - NFHS-4 (2016) and NFHS-5 (2021)
        year_column = "sgd.nfhs_value_5" if year == 2021 else "sgd.nfhs_value_4"
        
        # Enhanced query that uses database metadata for proper ranking
        # For bottom performers, we want lowest performance scores
        query = f"""
        WITH indicator_percentiles AS (
            SELECT 
                sgd.district_name,
                ds.state_name,
                sg.sdg_short_indicator_name,
                {year_column} as value,
                COALESCE(sg.higher_is_better, FALSE) as higher_is_better,
                sgd.aspirational_status,
                sgd.district_sdg_status,
                CASE 
                    WHEN COALESCE(sg.higher_is_better, FALSE) = TRUE THEN 
                        PERCENT_RANK() OVER (PARTITION BY sg.sdg_short_indicator_name ORDER BY {year_column} ASC) * 100
                    ELSE 
                        PERCENT_RANK() OVER (PARTITION BY sg.sdg_short_indicator_name ORDER BY {year_column} DESC) * 100
                END as performance_score
            FROM SDG_Goals_Data sgd
            JOIN SDG_Goals sg ON sgd.sdg_short_indicator_name = sg.sdg_short_indicator_name
            JOIN District_State ds ON sgd.district_name = ds.district_name
            WHERE sg.major_sdg_goal = %s
            AND {year_column} IS NOT NULL
            {state_filter}
            AND sg.sdg_short_indicator_name IN ({indicator_placeholders})
        ),
        district_scores AS (
            SELECT 
                district_name,
                state_name,
                AVG(performance_score) as avg_performance_score,
                COUNT(*) as indicator_count,
                MAX(aspirational_status) as aspirational_status,
                STRING_AGG(DISTINCT district_sdg_status, ', ' ORDER BY district_sdg_status) as district_sdg_status
            FROM indicator_percentiles
            GROUP BY district_name, state_name
        )
        SELECT 
            district_name,
            state_name,
            avg_performance_score as avg_score,
            indicator_count,
            aspirational_status,
            district_sdg_status
        FROM district_scores
        WHERE indicator_count >= 2  -- Ensure we have at least 2 indicators for reliable ranking
        ORDER BY avg_performance_score ASC  -- Lower performance score is worse
        LIMIT %s
        """
        
        cursor.execute(query, params)
        results = cursor.fetchall()
        
        # Get detailed indicator data
        if results:
            district_names = [row[0] for row in results]
            detailed_data = get_detailed_indicator_data(cursor, district_names, indicator_names, year)
        else:
            detailed_data = {}
        
        # Format results
        formatted_results = []
        for i, row in enumerate(results):
            district_indicators = detailed_data.get(row[0], [])
            primary_indicator = district_indicators[0] if district_indicators else {}
            
            # Calculate overall annual change across all indicators
            overall_annual_change, overall_change_interpretation = calculate_overall_annual_change(district_indicators)
            
            district_data = {
                "rank": i + 1,
                "district": row[0],
                "state": row[1],
                "performance_percentile": float(row[2]) if row[2] is not None else None,  # Renamed for clarity
                "indicators_available": int(row[3]),
                "aspirational_status": row[4],
                "district_sdg_status": row[5],
                "indicators": district_indicators,
                # Add clear primary values for consistent display
                "primary_indicator_value": primary_indicator.get("current_value"),
                "primary_indicator_name": primary_indicator.get("indicator_name"),
                # Use aggregated annual change for overall SDG performance
                "annual_change": overall_annual_change,
                "trend_status": overall_change_interpretation.get("interpretation") if isinstance(overall_change_interpretation, dict) else "unknown",
                "trend_description": overall_change_interpretation.get("description") if isinstance(overall_change_interpretation, dict) else "No trend data",
                "is_improving": overall_change_interpretation.get("is_improvement") if isinstance(overall_change_interpretation, dict) else None,
                # Add detailed overall trend analysis
                "overall_trend_analysis": overall_change_interpretation if isinstance(overall_change_interpretation, dict) else None,
                # Keep primary indicator for reference
                "primary_annual_change": primary_indicator.get("annual_change"),
                "primary_trend_status": primary_indicator.get("change_interpretation", {}).get("interpretation")
            }
            formatted_results.append(district_data)
        
        return {"data": formatted_results}
        
    except Exception as e:
        return {"error": f"Error getting bottom performers: {str(e)}"}

def get_detailed_indicator_data(cursor, district_names, indicator_names, year):
    """Get detailed indicator data for specific districts with enhanced change interpretation."""
    try:
        if not district_names or not indicator_names:
            return {}
        
        district_placeholders = ','.join(['%s'] * len(district_names))
        indicator_placeholders = ','.join(['%s'] * len(indicator_names))
        
        params = district_names + indicator_names
        
        # Determine year column - NFHS-4 (2016) and NFHS-5 (2021)
        year_column = "sgd.nfhs_value_5" if year == 2021 else "sgd.nfhs_value_4"
        
        query = f"""
        SELECT 
            sgd.district_name,
            sg.sdg_short_indicator_name,
            sg.sdg_full_indicator_name,
            sgd.nfhs_value_4,
            sgd.nfhs_value_5,
            sgd.actual_annual_change,
            COALESCE(sg.indicator_direction, 'lower_is_better') as direction,
            COALESCE(sg.higher_is_better, FALSE) as higher_is_better
        FROM SDG_Goals_Data sgd
        JOIN SDG_Goals sg ON sgd.sdg_short_indicator_name = sg.sdg_short_indicator_name
        WHERE sgd.district_name IN ({district_placeholders})
        AND sg.sdg_short_indicator_name IN ({indicator_placeholders})
        AND {year_column} IS NOT NULL
        ORDER BY sgd.district_name, sg.sdg_indicator_number
        """
        
        cursor.execute(query, params)
        results = cursor.fetchall()
        
        # Organize by district
        district_indicators = {}
        for row in results:
            district = row[0]
            if district not in district_indicators:
                district_indicators[district] = []
            
            current_value = row[4] if year == 2021 else row[3]
            direction = row[6]
            higher_is_better = row[7]
            annual_change = row[5]
            
            # Enhanced change interpretation
            change_interpretation = interpret_annual_change_enhanced(annual_change, direction)
            
            district_indicators[district].append({
                "indicator_name": row[1],
                "indicator_full_name": row[2],
                "nfhs_4_value": float(row[3]) if row[3] is not None else None,
                "nfhs_5_value": float(row[4]) if row[4] is not None else None,
                "current_value": float(current_value) if current_value is not None else None,
                "annual_change": float(annual_change) if annual_change is not None else None,
                "direction": direction,
                "higher_is_better": higher_is_better,
                "change_interpretation": change_interpretation
            })
        
        return district_indicators
        
    except Exception as e:
        print(f"Error getting detailed indicator data: {e}")
        return {}

def interpret_annual_change_enhanced(change_value, indicator_direction):
    """
    Enhanced interpretation of annual change based on indicator direction from database metadata.
    """
    if change_value is None:
        return {
            "interpretation": "unknown",
            "is_improvement": None,
            "description": "No change data available",
            "trend_icon": "❓"
        }
    
    if indicator_direction == "higher_is_better":
        # For positive indicators, positive change is good
        is_improvement = change_value > 0
        if change_value > 0:
            description = f"↗️ Improved by +{change_value:.2f} (positive trend)"
            trend_icon = "↗️"
        elif change_value < 0:
            description = f"↘️ Declined by {change_value:.2f} (concerning trend)"
            trend_icon = "↘️"
        else:
            description = "→ No change"
            trend_icon = "→"
    else:  # lower_is_better
        # For negative indicators, negative change is good
        is_improvement = change_value < 0
        if change_value < 0:
            description = f"↗️ Improved by {abs(change_value):.2f} reduction (positive trend)"
            trend_icon = "↗️"
        elif change_value > 0:
            description = f"↘️ Worsened by +{change_value:.2f} increase (concerning trend)"
            trend_icon = "↘️"
        else:
            description = "→ No change"
            trend_icon = "→"
    
    return {
        "interpretation": "improvement" if is_improvement else "deterioration" if change_value != 0 else "stable",
        "is_improvement": is_improvement,
        "description": description,
        "change_value": change_value,
        "trend_icon": trend_icon
    }

def format_sdg_goal_response(response_data):
    """Format the SDG goal response for better readability."""
    try:
        if response_data.get("error"):
            return response_data
        
        # Add summary statistics
        if response_data.get("data") and isinstance(response_data["data"], list):
            total_districts = len(response_data["data"])
            
            # Calculate average scores if available
            scores = [item.get("performance_percentile") for item in response_data["data"] if item.get("performance_percentile") is not None]
            avg_score = sum(scores) / len(scores) if scores else None
            
            response_data["summary"] = {
                "total_districts": total_districts,
                "average_score": round(avg_score, 2) if avg_score else None,
                "indicators_analyzed": len(response_data.get("indicators", [])),
                "analysis_type": response_data.get("query_type", "unknown")
            }
        
        elif isinstance(response_data.get("data"), dict) and response_data["data"].get("combined_data"):
            # Handle trend data
            top_count = len(response_data["data"].get("top_performers", []))
            bottom_count = len(response_data["data"].get("bottom_performers", []))
            
            response_data["summary"] = {
                "top_performers_count": top_count,
                "bottom_performers_count": bottom_count,
                "total_districts_analyzed": top_count + bottom_count,
                "indicators_analyzed": len(response_data.get("indicators", [])),
                "analysis_type": "trend_comparison"
            }
        
        # Add enhanced analysis text
        response_data["enhanced_analysis"] = generate_enhanced_sdg_analysis(response_data)
        
        return response_data
        
    except Exception as e:
        return {
            "error": f"Error formatting response: {str(e)}",
            "raw_data": response_data
        }

def get_sdg_goal_classification(
    sdg_goal_number: int,
    year: int = 2021,
    state_name: Optional[str] = None,
    classification_type: str = "status",
    default_indicator: Optional[str] = None
):
    """
    Get comprehensive SDG goal classification data for all indicators in the goal.
    This function provides all indicator data at once, allowing frontend to show
    classification for any indicator with dropdown selection.
    
    Parameters:
    - sdg_goal_number: SDG goal number (1-17)
    - year: 2016 or 2021
    - state_name: Optional state filter (None for all India)
    - classification_type: 'status' (by SDG status), 'performance' (by quartiles), or 'aspirational' (by aspirational status)
    - default_indicator: Which indicator to show first (if None, uses first available)
    """
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        
        # Get all indicators for this SDG goal
        cursor.execute("""
            SELECT sdg_short_indicator_name, sdg_full_indicator_name, sdg_indicator_number
            FROM SDG_Goals 
            WHERE major_sdg_goal = %s
            ORDER BY sdg_indicator_number
        """, (sdg_goal_number,))
        
        indicator_results = cursor.fetchall()
        if not indicator_results:
            return {
                "success": False,
                "error": f"No indicators found for SDG Goal {sdg_goal_number}",
                "data": []
            }
        
        available_indicators = []
        indicator_data_map = {}
        all_districts_data = []
        
        # Build state filter
        state_filter = ""
        base_params = []
        if state_name:
            state_filter = "AND ds.state_name ILIKE %s"
            base_params.append(f"%{state_name}%")
        
        # Determine year column
        year_column = "sgd.nfhs_value_5" if year == 2021 else "sgd.nfhs_value_4"
        
        # Process each indicator
        for indicator_row in indicator_results:
            indicator_short_name = indicator_row[0]
            indicator_full_name = indicator_row[1]
            indicator_number = indicator_row[2]
            
            # Get district data for this indicator
            params = [indicator_short_name] + base_params
            
            query = f"""
            SELECT 
                sgd.district_name,
                ds.state_name,
                {year_column} as indicator_value,
                sgd.nfhs_value_4,
                sgd.nfhs_value_5,
                sgd.actual_annual_change,
                sgd.aspirational_status,
                sgd.district_sdg_status,
                dg.district_name as has_geometry,
                COALESCE(sg.indicator_direction, 'lower_is_better') as direction,
                COALESCE(sg.higher_is_better, FALSE) as higher_is_better
            FROM SDG_Goals_Data sgd
            JOIN SDG_Goals sg ON sgd.sdg_short_indicator_name = sg.sdg_short_indicator_name
            JOIN District_State ds ON sgd.district_name = ds.district_name
            LEFT JOIN District_Geometry dg ON sgd.district_name = dg.district_name
            WHERE sgd.sdg_short_indicator_name = %s
            AND {year_column} IS NOT NULL
            {state_filter}
            ORDER BY ds.state_name, sgd.district_name
            """
            
            cursor.execute(query, params)
            results = cursor.fetchall()
            
            if results:
                # Add to available indicators
                district_count = len(results)
                available_indicators.append({
                    "short_name": indicator_short_name,
                    "full_name": indicator_full_name,
                    "indicator_number": indicator_number,
                    "district_count": district_count
                })
                
                # Extract values for classification thresholds
                values = [float(row[2]) for row in results if row[2] is not None]
                
                # Calculate classification thresholds for performance-based classification
                thresholds = None
                if classification_type == "performance" and values:
                    q1 = np.percentile(values, 25)
                    q2 = np.percentile(values, 50) 
                    q3 = np.percentile(values, 75)
                    thresholds = {"q1": q1, "q2": q2, "q3": q3}
                
                # Define classification functions
                def get_performance_category(value, thresholds):
                    if not thresholds or value is None:
                        return {"category": "Unknown", "color": "#757575", "level": 0}
                    if value <= thresholds["q1"]:
                        return {"category": "Excellent", "color": "#1a5d1a", "level": 4}
                    elif value <= thresholds["q2"]:
                        return {"category": "Good", "color": "#2d8f2d", "level": 3}
                    elif value <= thresholds["q3"]:
                        return {"category": "Fair", "color": "#ffa500", "level": 2}
                    else:
                        return {"category": "Needs Improvement", "color": "#d32f2f", "level": 1}
                
                def get_status_category(sdg_status):
                    status_mapping = {
                        "Achieved-I": {"category": "Achieved-I", "color": "#1a5d1a", "level": 4},
                        "Achieved-II": {"category": "Achieved-II", "color": "#2d8f2d", "level": 3},
                        "On-Target": {"category": "On-Target", "color": "#ffa500", "level": 2},
                        "Off-Target": {"category": "Off-Target", "color": "#d32f2f", "level": 1},
                        # Fallback mappings for potential variations
                        "Achiever": {"category": "Achieved-I", "color": "#1a5d1a", "level": 4},
                        "Front Runner": {"category": "Achieved-II", "color": "#2d8f2d", "level": 3},
                        "Performer": {"category": "On-Target", "color": "#ffa500", "level": 2},
                        "Aspirant": {"category": "Off-Target", "color": "#d32f2f", "level": 1}
                    }
                    return status_mapping.get(sdg_status, {"category": "Unknown", "color": "#757575", "level": 0})
                
                def get_aspirational_category(asp_status):
                    asp_mapping = {
                        "Aspirational": {"category": "Aspirational Districts", "color": "#d32f2f", "level": 1},
                        "Other": {"category": "Other Districts", "color": "#2d8f2d", "level": 2}
                    }
                    return asp_mapping.get(asp_status, {"category": "Unknown", "color": "#757575", "level": 0})
                
                # Process districts for this indicator
                classified_districts = []
                classification_summary = {}
                
                for row in results:
                    annual_change = row[5]
                    direction = row[9]
                    higher_is_better = row[10]
                    
                    # Enhanced change interpretation
                    change_interpretation = interpret_annual_change_enhanced(annual_change, direction)
                    
                    district_data = {
                        "district": row[0],
                        "state": row[1],
                        "indicator_value": float(row[2]) if row[2] is not None else None,
                        "nfhs_4_value": float(row[3]) if row[3] is not None else None,
                        "nfhs_5_value": float(row[4]) if row[4] is not None else None,
                        "annual_change": float(annual_change) if annual_change is not None else None,
                        "aspirational_status": row[6],
                        "district_sdg_status": row[7],
                        "has_geometry": row[8] is not None,
                        "direction": direction,
                        "higher_is_better": higher_is_better,
                        "change_interpretation": change_interpretation
                    }
                    
                    # Apply classification based on type
                    if classification_type == "performance":
                        classification = get_performance_category(district_data["indicator_value"], thresholds)
                    elif classification_type == "status":
                        classification = get_status_category(district_data["district_sdg_status"])
                    elif classification_type == "aspirational":
                        classification = get_aspirational_category(district_data["aspirational_status"])
                    
                    district_data.update(classification)
                    classified_districts.append(district_data)
                    
                    # Update summary
                    cat = classification["category"]
                    if cat not in classification_summary:
                        classification_summary[cat] = {"count": 0, "color": classification["color"]}
                    classification_summary[cat]["count"] += 1
                
                # Sort by classification level (best first)
                classified_districts.sort(key=lambda x: x["level"], reverse=True)
                
                # Store data for this indicator
                indicator_data_map[indicator_short_name] = {
                    "indicator_name": indicator_short_name,
                    "indicator_full_name": indicator_full_name,
                    "indicator_number": indicator_number,
                    "data": classified_districts,
                    "classification_summary": classification_summary,
                    "total_districts": len(classified_districts),
                    "thresholds": thresholds
                }
                
                # Collect all districts for boundary data (avoiding duplicates)
                for district in classified_districts:
                    if district["has_geometry"] and not any(d["district"] == district["district"] for d in all_districts_data):
                        all_districts_data.append({
                            "district": district["district"],
                            "state": district["state"]
                        })
        
        cursor.close()
        conn.close()
        
        if not available_indicators:
            return {
                "success": False,
                "error": f"No data found for SDG Goal {sdg_goal_number}" + (f" in {state_name}" if state_name else ""),
                "available_indicators": [],
                "data": []
            }
        
        # Determine default indicator if not specified
        if not default_indicator or default_indicator not in indicator_data_map:
            default_indicator = available_indicators[0]["short_name"]
        
        # Get boundary data for all districts
        boundary_data = []
        if all_districts_data:
            district_names = [d["district"] for d in all_districts_data]
            boundary_data = get_district_boundary_data(district_names)
        
        # Get state coverage summary for default indicator
        default_data = indicator_data_map[default_indicator]
        state_summary = {}
        for district in default_data["data"]:
            state = district["state"]
            if state not in state_summary:
                state_summary[state] = {"total": 0, "categories": {}}
            state_summary[state]["total"] += 1
            
            cat = district["category"]
            if cat not in state_summary[state]["categories"]:
                state_summary[state]["categories"][cat] = 0
            state_summary[state]["categories"][cat] += 1
        
        return {
            "success": True,
            "sdg_goal": sdg_goal_number,
            "year": year,
            "state_name": state_name,
            "classification_type": classification_type,
            "available_indicators": available_indicators,
            "indicator_data_map": indicator_data_map,
            "default_indicator": default_indicator,
            "current_indicator": default_indicator,
            # For compatibility with existing frontend components
            "indicator_name": default_data["indicator_name"],
            "indicator_full_name": default_data["indicator_full_name"],
            "data": default_data["data"],
            "classification_summary": default_data["classification_summary"],
            "total_districts": default_data["total_districts"],
            "boundary": boundary_data,
            "state_summary": state_summary,
            "districts_with_boundaries": len(boundary_data),
            "map_type": "sdg_goal_classification",
            "coverage_info": {
                "total_districts_with_data": default_data["total_districts"],
                "districts_with_geometry": len([d for d in default_data["data"] if d.get("has_geometry")]),
                "coverage_percentage": round((len(boundary_data) / default_data["total_districts"]) * 100, 1) if default_data["total_districts"] > 0 else 0
            },
            "thresholds": default_data.get("thresholds")
        }
        
    except Exception as e:
        return {
            "success": False,
            "error": f"Error in SDG goal classification: {str(e)}",
            "available_indicators": [],
            "data": []
        }

def generate_enhanced_sdg_analysis(response_data):
    """
    Generate comprehensive, accurate analysis text for SDG data based on enhanced data structure.
    """
    try:
        if response_data.get("error"):
            return "Analysis could not be generated due to data error."
        
        data = response_data.get("data", [])
        if not data:
            return "No data available for analysis."
        
        sdg_goal = response_data.get("sdg_goal")
        indicators = response_data.get("indicators", [])
        year = response_data.get("year", 2021)
        query_type = response_data.get("query_type", "unknown")
        
        primary_indicator = indicators[0] if indicators else "SDG Indicator"
        is_rate_indicator = any(term in primary_indicator.lower() for term in ["rate", "ratio", "percentage", "prevalence"])
        is_negative_indicator = any(term in primary_indicator.lower() for term in 
                                  ["mortality", "death", "malnutrition", "stunting", "wasting", "anaemia", 
                                   "poverty", "dropout", "marriage", "pregnancy", "disease"])
        
        analysis_parts = []
        
        # Handle combined/trend data
        if isinstance(data, dict) and data.get("combined_data"):
            top_performers = data.get("top_performers", [])
            bottom_performers = data.get("bottom_performers", [])
            
            analysis_parts.append(f"### Comparative Performance Analysis: SDG Goal {sdg_goal}")
            analysis_parts.append(f"**Data Year:** {year}")
            analysis_parts.append(f"**Analysis Type:** Overall SDG performance across {response_data.get('indicators', []) and len(response_data['indicators'])} indicators")
            analysis_parts.append("")
            
            # ENHANCED: Detailed Top Performers Analysis
            if top_performers:
                improving_top = sum(1 for d in top_performers if d.get("is_improving") == True)
                
                analysis_parts.append(f"#### 🏆 Top {len(top_performers)} Performing Districts")
                analysis_parts.append("")
                
                for i, district in enumerate(top_performers[:3], 1):  # Show top 3 in detail
                    district_name = district.get("district", "Unknown")
                    state = district.get("state", "Unknown")
                    performance_score = district.get("performance_percentile", 0)
                    annual_change = district.get("annual_change")
                    is_improving = district.get("is_improving")
                    trend_analysis = district.get("overall_trend_analysis", {})
                    
                    analysis_parts.append(f"**{i}. {district_name}, {state}**")
                    analysis_parts.append(f"- **Performance Percentile**: {performance_score:.1f}% (Rank {district.get('rank', i)})")
                    
                    if trend_analysis:
                        analysis_parts.append(f"- **Overall Trend**: {trend_analysis.get('trend_icon', '')} {trend_analysis.get('interpretation', 'N/A').title()}")
                        analysis_parts.append(f"- **Indicator Breakdown**: {trend_analysis.get('improvement_count', 0)} improving, {trend_analysis.get('deterioration_count', 0)} declining ({trend_analysis.get('total_indicators', 0)} total)")
                        if annual_change is not None:
                            analysis_parts.append(f"- **Average Annual Change**: {annual_change:+.2f}")
                    elif annual_change is not None:
                        trend_emoji = "↗️" if is_improving else "↘️" if is_improving == False else "→"
                        analysis_parts.append(f"- **Trend**: {trend_emoji} {annual_change:+.2f} annual change")
                    
                    analysis_parts.append("")
                
                # Summary for remaining top performers
                if len(top_performers) > 3:
                    remaining_count = len(top_performers) - 3
                    remaining_improving = sum(1 for d in top_performers[3:] if d.get("is_improving") == True)
                    analysis_parts.append(f"**Remaining {remaining_count} top performers**: {remaining_improving}/{remaining_count} showing improvement")
                    analysis_parts.append("")
                
                analysis_parts.append(f"**Top Performers Summary**: {improving_top}/{len(top_performers)} districts improving overall")
                analysis_parts.append("")
            
            # ENHANCED: Detailed Bottom Performers Analysis
            if bottom_performers:
                improving_bottom = sum(1 for d in bottom_performers if d.get("is_improving") == True)
                
                analysis_parts.append(f"#### ⚠️ Districts Requiring Priority Attention")
                analysis_parts.append("")
                
                for i, district in enumerate(bottom_performers[:3], 1):  # Show bottom 3 in detail
                    district_name = district.get("district", "Unknown")
                    state = district.get("state", "Unknown")
                    performance_score = district.get("performance_percentile", 0)
                    annual_change = district.get("annual_change")
                    is_improving = district.get("is_improving")
                    trend_analysis = district.get("overall_trend_analysis", {})
                    
                    analysis_parts.append(f"**{i}. {district_name}, {state}**")
                    analysis_parts.append(f"- **Performance Percentile**: {performance_score:.1f}% (Needs improvement)")
                    
                    if trend_analysis:
                        analysis_parts.append(f"- **Overall Trend**: {trend_analysis.get('trend_icon', '')} {trend_analysis.get('interpretation', 'N/A').title()}")
                        analysis_parts.append(f"- **Indicator Breakdown**: {trend_analysis.get('improvement_count', 0)} improving, {trend_analysis.get('deterioration_count', 0)} declining ({trend_analysis.get('total_indicators', 0)} total)")
                        if annual_change is not None:
                            analysis_parts.append(f"- **Average Annual Change**: {annual_change:+.2f}")
                    elif annual_change is not None:
                        trend_emoji = "↗️" if is_improving else "↘️" if is_improving == False else "→"
                        analysis_parts.append(f"- **Trend**: {trend_emoji} {annual_change:+.2f} annual change")
                    
                    # Add urgency assessment
                    if trend_analysis and trend_analysis.get('deterioration_count', 0) > trend_analysis.get('improvement_count', 0):
                        analysis_parts.append(f"- **⚠️ Priority**: High - More indicators declining than improving")
                    elif is_improving == False:
                        analysis_parts.append(f"- **⚠️ Priority**: Medium - Declining trend needs intervention")
                    else:
                        analysis_parts.append(f"- **✅ Opportunity**: Positive momentum to build upon")
                    
                    analysis_parts.append("")
                
                # Summary for remaining bottom performers
                if len(bottom_performers) > 3:
                    remaining_count = len(bottom_performers) - 3
                    remaining_improving = sum(1 for d in bottom_performers[3:] if d.get("is_improving") == True)
                    analysis_parts.append(f"**Remaining {remaining_count} districts needing support**: {remaining_improving}/{remaining_count} showing improvement")
                    analysis_parts.append("")
                
                analysis_parts.append(f"**Bottom Performers Summary**: {improving_bottom}/{len(bottom_performers)} districts showing improvement despite low performance")
                analysis_parts.append("")
            
            # ENHANCED: Comprehensive Gap Analysis
            if top_performers and bottom_performers:
                # Performance gap
                top_avg = sum(d.get("performance_percentile", 0) for d in top_performers) / len(top_performers)
                bottom_avg = sum(d.get("performance_percentile", 0) for d in bottom_performers) / len(bottom_performers)
                gap = top_avg - bottom_avg
                
                analysis_parts.append(f"#### 📊 Performance Gap Analysis")
                analysis_parts.append(f"- **Performance Gap**: {gap:.1f} percentile points between top and bottom performers")
                analysis_parts.append(f"- **Top Average**: {top_avg:.1f}th percentile")
                analysis_parts.append(f"- **Bottom Average**: {bottom_avg:.1f}th percentile")
                
                # Trend comparison
                total_improving_top = sum(1 for d in top_performers if d.get("is_improving") == True)
                total_improving_bottom = sum(1 for d in bottom_performers if d.get("is_improving") == True)
                
                analysis_parts.append(f"- **Trend Comparison**: Top performers {total_improving_top}/{len(top_performers)} improving vs Bottom performers {total_improving_bottom}/{len(bottom_performers)} improving")
                
                # Priority assessment
                if gap > 15:
                    priority = "CRITICAL"
                    action = "Immediate large-scale intervention required"
                elif gap > 10:
                    priority = "HIGH"
                    action = "Significant intervention needed"
                elif gap > 5:
                    priority = "MEDIUM"
                    action = "Targeted support required"
                else:
                    priority = "LOW"
                    action = "Moderate disparities manageable"
                
                analysis_parts.append(f"- **Priority Level**: {priority} - {action}")
                analysis_parts.append("")
            
            # ENHANCED: Strategic Recommendations
            analysis_parts.append("#### 🎯 Strategic Recommendations")
            analysis_parts.append("")
            
            if top_performers and bottom_performers:
                # Best practices sharing
                best_district = top_performers[0] if top_performers else None
                if best_district:
                    analysis_parts.append(f"1. **Best Practice Replication**: Study {best_district.get('district')}, {best_district.get('state')} ({best_district.get('performance_percentile', 0):.1f}th percentile) as a model for intervention strategies")
                
                # Urgent interventions
                worst_district = bottom_performers[0] if bottom_performers else None
                if worst_district:
                    analysis_parts.append(f"2. **Priority Intervention**: Focus immediate resources on {worst_district.get('district')}, {worst_district.get('state')} and similar low-performing districts")
                
                # Trend-based actions
                if total_improving_bottom > 0:
                    analysis_parts.append(f"3. **Momentum Building**: {total_improving_bottom} bottom-performing districts show positive trends - accelerate support")
                
                declining_top = len(top_performers) - total_improving_top
                if declining_top > 0:
                    analysis_parts.append(f"4. **Prevent Backsliding**: {declining_top} top-performing districts show concerning trends - investigate and prevent deterioration")
                
                analysis_parts.append("5. **Comprehensive Monitoring**: Establish integrated tracking across all indicators to maintain holistic SDG progress")
            
            return "\n".join(analysis_parts)
        
        # Handle single list data (top or bottom performers)
        elif isinstance(data, list) and len(data) > 0:
            # Title and Context
            if query_type == "top_performers":
                performance_term = "Lowest Rates" if is_negative_indicator else "Highest Performance"
                analysis_parts.append(f"### Best Performing Districts ({performance_term})")
                analysis_parts.append(f"**Indicator:** {primary_indicator}")
                analysis_parts.append(f"**Data Year:** {year}")
                analysis_parts.append("")
            
            # Current performance analysis
            top_districts = data[:3] if len(data) >= 3 else data
            
            analysis_parts.append("#### Top Performing Districts")
            analysis_parts.append("")
            
            for i, district in enumerate(top_districts, 1):
                district_name = district.get("district", "Unknown")
                state = district.get("state", "Unknown")
                current_value = district.get("primary_indicator_value")
                annual_change = district.get("annual_change")
                is_improving = district.get("is_improving")
                
                analysis_parts.append(f"**{i}. {district_name}, {state}**")
                
                if current_value is not None:
                    value_desc = "Current Rate" if is_rate_indicator else "Current Value"
                    unit = " per 1,000" if "birth rate" in primary_indicator.lower() else ""
                    analysis_parts.append(f"- **{value_desc}**: {current_value:.2f}{unit}")
                
                if annual_change is not None:
                    change_desc = "Annual Change"
                    if is_improving is not None:
                        if is_improving:
                            trend_emoji = "📈" if not is_negative_indicator else "📉"
                            trend_word = "Improving"
                            change_desc += f": {annual_change:+.2f} ({trend_word} trend {trend_emoji})"
                        else:
                            trend_emoji = "📉" if not is_negative_indicator else "📈" 
                            trend_word = "Worsening"
                            change_desc += f": {annual_change:+.2f} ({trend_word} trend {trend_emoji})"
                    else:
                        change_desc += f": {annual_change:+.2f}"
                    
                    analysis_parts.append(f"- **{change_desc}**")
                
                # Analysis interpretation
                if current_value is not None and annual_change is not None:
                    if is_improving:
                        analysis_parts.append(f"- **Analysis**: Strong performer with positive trajectory - a model district.")
                    elif is_improving == False:
                        if is_negative_indicator:
                            analysis_parts.append(f"- **Analysis**: Currently performs well but shows concerning deterioration that requires immediate attention.")
                        else:
                            analysis_parts.append(f"- **Analysis**: Strong baseline performance but declining trend needs intervention.")
                    else:
                        analysis_parts.append(f"- **Analysis**: Maintains good performance with stable indicators.")
                
                analysis_parts.append("")
            
            # Key insights
            improving_count = sum(1 for d in data if d.get("is_improving") == True)
            worsening_count = sum(1 for d in data if d.get("is_improving") == False)
            total_analyzed = len(data)
            
            analysis_parts.append("#### Key Insights")
            analysis_parts.append("")
            
            # Direction insight
            direction_note = "lower values indicate better performance" if is_negative_indicator else "higher values indicate better performance"
            analysis_parts.append(f"**Indicator Direction**: For {primary_indicator}, {direction_note}.")
            analysis_parts.append("")
            
            # Trend insight
            if improving_count > worsening_count:
                analysis_parts.append(f"**Positive Momentum**: {improving_count}/{total_analyzed} top districts are improving, indicating effective interventions.")
            elif worsening_count > improving_count:
                analysis_parts.append(f"**Concerning Pattern**: {worsening_count}/{total_analyzed} top districts show deteriorating trends despite good current performance.")
            else:
                analysis_parts.append(f"**Mixed Trends**: Equal numbers improving ({improving_count}) and worsening ({worsening_count}), requiring targeted analysis.")
            analysis_parts.append("")
            
            # Recommendations
            analysis_parts.append("#### Recommendations")
            analysis_parts.append("")
            
            if worsening_count > 0:
                analysis_parts.append("1. **Immediate Action Required**: Investigate why top-performing districts are experiencing deteriorating trends.")
                analysis_parts.append("2. **Maintain Excellence**: Implement monitoring systems to preserve gains in well-performing districts.")
            else:
                analysis_parts.append("1. **Scale Success**: Study and replicate successful interventions from these top performers.")
            
            if is_negative_indicator:
                if "pregnancy" in primary_indicator.lower():
                    analysis_parts.append("2. **Targeted Interventions**: Strengthen adolescent health programs and education initiatives.")
                    analysis_parts.append("3. **Community Engagement**: Involve local communities in awareness and prevention programs.")
                elif "mortality" in primary_indicator.lower():
                    analysis_parts.append("2. **Healthcare Strengthening**: Improve access to quality healthcare services.")
                    analysis_parts.append("3. **Prevention Focus**: Enhance preventive care and early intervention programs.")
                elif "malnutrition" in primary_indicator.lower() or "stunting" in primary_indicator.lower():
                    analysis_parts.append("2. **Nutrition Programs**: Strengthen maternal and child nutrition interventions.")
                    analysis_parts.append("3. **Multi-sectoral Approach**: Integrate health, education, and social protection programs.")
            else:
                analysis_parts.append("2. **Capacity Building**: Invest in infrastructure and human resources to maintain performance.")
                analysis_parts.append("3. **Innovation**: Explore new approaches to further improve outcomes.")
            
            analysis_parts.append("4. **Data Monitoring**: Establish regular monitoring systems to track progress and identify emerging issues early.")
            
            return "\n".join(analysis_parts)
        
        return "No analysis available for this data structure."
        
    except Exception as e:
        return f"Error generating analysis: {str(e)}"

def get_specific_indicator_data(
    sdg_goal_number: int,
    indicator_name: str,
    year: int = 2021,
    query_type: str = "top_performers",
    top_n: int = 5,
    state_name: Optional[str] = None
):
    """
    Get data for a specific indicator using actual indicator values instead of percentiles.
    This is used when users ask about a particular indicator to avoid confusion.
    
    Parameters:
    - sdg_goal_number: SDG goal number (1-17)
    - indicator_name: Specific indicator name (will be resolved via fuzzy matching)
    - year: 2016 or 2021
    - query_type: 'top_performers', 'bottom_performers', 'trend'
    - top_n: Number of districts to return
    - state_name: Optional state filter
    """
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        
        # Resolve indicator name using fuzzy matching
        resolved_indicator = None
        
        # Try exact match first
        cursor.execute("""
            SELECT sdg_short_indicator_name, sdg_full_indicator_name, 
                   COALESCE(sg.indicator_direction, 'lower_is_better') as direction,
                   COALESCE(sg.higher_is_better, FALSE) as higher_is_better
            FROM SDG_Goals sg
            WHERE major_sdg_goal = %s 
            AND (sdg_short_indicator_name ILIKE %s OR sdg_full_indicator_name ILIKE %s)
        """, (sdg_goal_number, indicator_name, indicator_name))
        exact_match = cursor.fetchone()
        
        if exact_match:
            resolved_indicator = exact_match
        else:
            # Try fuzzy matching
            fuzzy_match = fuzzy_match_indicator(indicator_name, sdg_goal_number)
            if fuzzy_match:
                cursor.execute("""
                    SELECT sdg_short_indicator_name, sdg_full_indicator_name,
                           COALESCE(sg.indicator_direction, 'lower_is_better') as direction,
                           COALESCE(sg.higher_is_better, FALSE) as higher_is_better
                    FROM SDG_Goals sg
                    WHERE major_sdg_goal = %s 
                    AND (sdg_short_indicator_name = %s OR sdg_full_indicator_name = %s)
                """, (sdg_goal_number, fuzzy_match, fuzzy_match))
                resolved_indicator = cursor.fetchone()
        
        if not resolved_indicator:
            return {
                "error": f"Indicator '{indicator_name}' not found in SDG Goal {sdg_goal_number}",
                "sdg_goal": sdg_goal_number
            }
        
        indicator_short_name = resolved_indicator[0]
        indicator_full_name = resolved_indicator[1]
        indicator_direction = resolved_indicator[2]
        higher_is_better = resolved_indicator[3]
        
        # Build the query based on query type
        if query_type == "top_performers":
            data = get_specific_indicator_top_performers(
                cursor, indicator_short_name, year, top_n, state_name, higher_is_better
            )
        elif query_type == "bottom_performers":
            data = get_specific_indicator_bottom_performers(
                cursor, indicator_short_name, year, top_n, state_name, higher_is_better
            )
        elif query_type == "trend":
            # Get both top and bottom performers
            top_data = get_specific_indicator_top_performers(
                cursor, indicator_short_name, year, top_n, state_name, higher_is_better
            )
            bottom_data = get_specific_indicator_bottom_performers(
                cursor, indicator_short_name, year, top_n, state_name, higher_is_better
            )
            data = {
                "top_performers": top_data.get("data", []),
                "bottom_performers": bottom_data.get("data", []),
                "combined_data": True
            }
        else:
            # Default to top performers
            data = get_specific_indicator_top_performers(
                cursor, indicator_short_name, year, top_n, state_name, higher_is_better
            )
        
        cursor.close()
        conn.close()
        
        # Get boundary data
        boundary_data = []
        if isinstance(data, dict):
            if isinstance(data.get("data"), list):
                district_names = [item.get("district") for item in data["data"] if isinstance(item, dict) and item.get("district")]
                boundary_data = get_district_boundary_data(district_names)
            elif data.get("combined_data"):
                top_districts = [item.get("district") for item in data.get("top_performers", []) if isinstance(item, dict) and item.get("district")]
                bottom_districts = [item.get("district") for item in data.get("bottom_performers", []) if isinstance(item, dict) and item.get("district")]
                all_districts = list(set(top_districts + bottom_districts))
                boundary_data = get_district_boundary_data(all_districts)
        
        # Format response
        response_data = {
            "sdg_goal": sdg_goal_number,
            "indicator_name": indicator_short_name,
            "indicator_full_name": indicator_full_name,
            "indicator_direction": indicator_direction,
            "higher_is_better": higher_is_better,
            "year": year,
            "query_type": query_type,
            "data": data.get("data") if isinstance(data, dict) and not data.get("combined_data") else data,
            "boundary": boundary_data,
            "map_type": "specific_indicator_analysis",
            "total_districts": (len(data.get("data", [])) if isinstance(data, dict) and not data.get("combined_data") else 
                              (len(data.get("top_performers", [])) + len(data.get("bottom_performers", [])) if isinstance(data, dict) else 0)),
            "analysis_type": "specific_indicator"
        }
        
        return format_specific_indicator_response(response_data)
        
    except Exception as e:
        return {"error": f"Error retrieving specific indicator data: {str(e)}"}

def get_specific_indicator_top_performers(cursor, indicator_short_name, year, top_n, state_name, higher_is_better):
    """Get top performing districts for a specific indicator using actual values."""
    try:
        state_filter = ""
        params = [indicator_short_name]
        
        if state_name:
            state_filter = "AND ds.state_name ILIKE %s"
            params.append(f"%{state_name}%")
        
        params.append(top_n)
        
        # Determine year column
        year_column = "sgd.nfhs_value_5" if year == 2021 else "sgd.nfhs_value_4"
        
        # Order by actual values based on indicator direction
        order_direction = "DESC" if higher_is_better else "ASC"
        
        query = f"""
        SELECT 
            sgd.district_name,
            ds.state_name,
            {year_column} as indicator_value,
            sgd.nfhs_value_4,
            sgd.nfhs_value_5,
            sgd.actual_annual_change,
            sgd.aspirational_status,
            sgd.district_sdg_status,
            COALESCE(sg.indicator_direction, 'lower_is_better') as direction,
            COALESCE(sg.higher_is_better, FALSE) as higher_is_better
        FROM SDG_Goals_Data sgd
        JOIN SDG_Goals sg ON sgd.sdg_short_indicator_name = sg.sdg_short_indicator_name
        JOIN District_State ds ON sgd.district_name = ds.district_name
        WHERE sgd.sdg_short_indicator_name = %s
        AND {year_column} IS NOT NULL
        {state_filter}
        ORDER BY {year_column} {order_direction}
        LIMIT %s
        """
        
        cursor.execute(query, params)
        results = cursor.fetchall()
        
        # Format results
        formatted_results = []
        for i, row in enumerate(results):
            annual_change = row[5]
            direction = row[8]
            
            # Enhanced change interpretation
            change_interpretation = interpret_annual_change_enhanced(annual_change, direction)
            
            district_data = {
                "rank": i + 1,
                "district": row[0],
                "state": row[1],
                "indicator_value": float(row[2]) if row[2] is not None else None,  # Actual value instead of percentile
                "nfhs_4_value": float(row[3]) if row[3] is not None else None,
                "nfhs_5_value": float(row[4]) if row[4] is not None else None,
                "annual_change": float(annual_change) if annual_change is not None else None,
                "aspirational_status": row[6],
                "district_sdg_status": row[7],
                "direction": direction,
                "higher_is_better": row[9],
                "change_interpretation": change_interpretation,
                # For consistency with existing frontend
                "primary_indicator_value": float(row[2]) if row[2] is not None else None,
                "trend_status": change_interpretation.get("interpretation"),
                "trend_description": change_interpretation.get("description"),
                "is_improving": change_interpretation.get("is_improvement")
            }
            formatted_results.append(district_data)
        
        return {"data": formatted_results}
        
    except Exception as e:
        return {"error": f"Error getting top performers for specific indicator: {str(e)}"}

def get_specific_indicator_bottom_performers(cursor, indicator_short_name, year, top_n, state_name, higher_is_better):
    """Get bottom performing districts for a specific indicator using actual values."""
    try:
        state_filter = ""
        params = [indicator_short_name]
        
        if state_name:
            state_filter = "AND ds.state_name ILIKE %s"
            params.append(f"%{state_name}%")
        
        params.append(top_n)
        
        # Determine year column
        year_column = "sgd.nfhs_value_5" if year == 2021 else "sgd.nfhs_value_4"
        
        # Order by actual values based on indicator direction (opposite of top performers)
        order_direction = "ASC" if higher_is_better else "DESC"
        
        query = f"""
        SELECT 
            sgd.district_name,
            ds.state_name,
            {year_column} as indicator_value,
            sgd.nfhs_value_4,
            sgd.nfhs_value_5,
            sgd.actual_annual_change,
            sgd.aspirational_status,
            sgd.district_sdg_status,
            COALESCE(sg.indicator_direction, 'lower_is_better') as direction,
            COALESCE(sg.higher_is_better, FALSE) as higher_is_better
        FROM SDG_Goals_Data sgd
        JOIN SDG_Goals sg ON sgd.sdg_short_indicator_name = sg.sdg_short_indicator_name
        JOIN District_State ds ON sgd.district_name = ds.district_name
        WHERE sgd.sdg_short_indicator_name = %s
        AND {year_column} IS NOT NULL
        {state_filter}
        ORDER BY {year_column} {order_direction}
        LIMIT %s
        """
        
        cursor.execute(query, params)
        results = cursor.fetchall()
        
        # Format results
        formatted_results = []
        for i, row in enumerate(results):
            annual_change = row[5]
            direction = row[8]
            
            # Enhanced change interpretation
            change_interpretation = interpret_annual_change_enhanced(annual_change, direction)
            
            district_data = {
                "rank": i + 1,
                "district": row[0],
                "state": row[1],
                "indicator_value": float(row[2]) if row[2] is not None else None,  # Actual value instead of percentile
                "nfhs_4_value": float(row[3]) if row[3] is not None else None,
                "nfhs_5_value": float(row[4]) if row[4] is not None else None,
                "annual_change": float(annual_change) if annual_change is not None else None,
                "aspirational_status": row[6],
                "district_sdg_status": row[7],
                "direction": direction,
                "higher_is_better": row[9],
                "change_interpretation": change_interpretation,
                # For consistency with existing frontend
                "primary_indicator_value": float(row[2]) if row[2] is not None else None,
                "trend_status": change_interpretation.get("interpretation"),
                "trend_description": change_interpretation.get("description"),
                "is_improving": change_interpretation.get("is_improvement")
            }
            formatted_results.append(district_data)
        
        return {"data": formatted_results}
        
    except Exception as e:
        return {"error": f"Error getting bottom performers for specific indicator: {str(e)}"}

def format_specific_indicator_response(response_data):
    """Format the specific indicator response for better readability."""
    try:
        if response_data.get("error"):
            return response_data
        
        # Add summary statistics
        if response_data.get("data") and isinstance(response_data["data"], list):
            total_districts = len(response_data["data"])
            
            # Calculate statistics based on actual indicator values
            values = [item.get("indicator_value") for item in response_data["data"] if item.get("indicator_value") is not None]
            
            if values:
                avg_value = sum(values) / len(values)
                min_value = min(values)
                max_value = max(values)
                
                response_data["summary"] = {
                    "total_districts": total_districts,
                    "average_value": round(avg_value, 2),
                    "min_value": round(min_value, 2),
                    "max_value": round(max_value, 2),
                    "indicator_analyzed": response_data.get("indicator_name", ""),
                    "analysis_type": response_data.get("query_type", "unknown")
                }
        
        elif isinstance(response_data.get("data"), dict) and response_data["data"].get("combined_data"):
            # Handle trend data
            top_count = len(response_data["data"].get("top_performers", []))
            bottom_count = len(response_data["data"].get("bottom_performers", []))
            
            response_data["summary"] = {
                "top_performers_count": top_count,
                "bottom_performers_count": bottom_count,
                "total_districts_analyzed": top_count + bottom_count,
                "indicator_analyzed": response_data.get("indicator_name", ""),
                "analysis_type": "specific_indicator_trend_comparison"
            }
        
        # Add enhanced analysis text for specific indicators
        response_data["enhanced_analysis"] = generate_specific_indicator_analysis(response_data)
        
        return response_data
        
    except Exception as e:
        return {
            "error": f"Error formatting specific indicator response: {str(e)}",
            "raw_data": response_data
        }

def generate_specific_indicator_analysis(response_data):
    """Generate analysis text specifically for individual indicator queries."""
    try:
        if response_data.get("error"):
            return "Analysis could not be generated due to data error."
        
        data = response_data.get("data", [])
        if not data:
            return "No data available for analysis."
        
        indicator_name = response_data.get("indicator_name", "")
        indicator_full_name = response_data.get("indicator_full_name", "")
        higher_is_better = response_data.get("higher_is_better", False)
        year = response_data.get("year", 2021)
        query_type = response_data.get("query_type", "unknown")
        
        analysis_parts = []
        
        # Handle combined/trend data
        if isinstance(data, dict) and data.get("combined_data"):
            top_performers = data.get("top_performers", [])
            bottom_performers = data.get("bottom_performers", [])
            
            analysis_parts.append(f"### {indicator_full_name} - Comparative Analysis")
            analysis_parts.append(f"**Data Year:** {year}")
            analysis_parts.append("")
            
            # Performance direction note
            direction_note = "higher values indicate better performance" if higher_is_better else "lower values indicate better performance"
            analysis_parts.append(f"**Indicator Direction**: For {indicator_name}, {direction_note}.")
            analysis_parts.append("")
            
            # Top performers summary
            if top_performers:
                best_performer = top_performers[0]
                best_value = best_performer.get("indicator_value")
                improving_top = sum(1 for d in top_performers if d.get("is_improving") == True)
                
                analysis_parts.append(f"#### Best Performing Districts")
                analysis_parts.append(f"- **Leading District**: {best_performer.get('district')}, {best_performer.get('state')}")
                if best_value is not None:
                    analysis_parts.append(f"- **Best Value**: {best_value:.2f}")
                analysis_parts.append(f"- **Improving Trends**: {improving_top}/{len(top_performers)} districts")
                analysis_parts.append("")
            
            # Bottom performers summary
            if bottom_performers:
                worst_performer = bottom_performers[0]
                worst_value = worst_performer.get("indicator_value")
                improving_bottom = sum(1 for d in bottom_performers if d.get("is_improving") == True)
                
                analysis_parts.append(f"#### Districts Needing Attention")
                analysis_parts.append(f"- **Requires Priority**: {worst_performer.get('district')}, {worst_performer.get('state')}")
                if worst_value is not None:
                    analysis_parts.append(f"- **Current Value**: {worst_value:.2f}")
                analysis_parts.append(f"- **Improving Trends**: {improving_bottom}/{len(bottom_performers)} districts")
                analysis_parts.append("")
            
            # Performance gap analysis
            if top_performers and bottom_performers and best_value is not None and worst_value is not None:
                gap = abs(best_value - worst_value)
                analysis_parts.append(f"#### Performance Gap")
                analysis_parts.append(f"- **Gap Size**: {gap:.2f} points between best and worst performers")
                analysis_parts.append("")
            
            return "\n".join(analysis_parts)
        
        # Handle single list data (top or bottom performers)
        elif isinstance(data, list) and len(data) > 0:
            performance_term = "Best Performing" if query_type == "top_performers" else "Districts Needing Attention"
            
            analysis_parts.append(f"### {performance_term} Districts: {indicator_full_name}")
            analysis_parts.append(f"**Data Year:** {year}")
            analysis_parts.append("")
            
            # Performance direction note
            direction_note = "higher values indicate better performance" if higher_is_better else "lower values indicate better performance"
            analysis_parts.append(f"**Indicator Direction**: For {indicator_name}, {direction_note}.")
            analysis_parts.append("")
            
            # Top districts analysis
            top_districts = data[:3] if len(data) >= 3 else data
            
            analysis_parts.append(f"#### Top {len(top_districts)} Districts")
            analysis_parts.append("")
            
            for i, district in enumerate(top_districts, 1):
                district_name = district.get("district", "Unknown")
                state = district.get("state", "Unknown")
                indicator_value = district.get("indicator_value")
                annual_change = district.get("annual_change")
                is_improving = district.get("is_improving")
                
                analysis_parts.append(f"**{i}. {district_name}, {state}**")
                
                if indicator_value is not None:
                    analysis_parts.append(f"- **Current Value**: {indicator_value:.2f}")
                
                if annual_change is not None:
                    change_desc = "Annual Change"
                    if is_improving is not None:
                        if is_improving:
                            trend_emoji = "📈" if higher_is_better else "📉"
                            trend_word = "Improving"
                            change_desc += f": {annual_change:+.2f} ({trend_word} trend {trend_emoji})"
                        else:
                            trend_emoji = "📉" if higher_is_better else "📈" 
                            trend_word = "Worsening"
                            change_desc += f": {annual_change:+.2f} ({trend_word} trend {trend_emoji})"
                    else:
                        change_desc += f": {annual_change:+.2f}"
                    
                    analysis_parts.append(f"- **{change_desc}**")
                
                analysis_parts.append("")
            
            # Key insights
            improving_count = sum(1 for d in data if d.get("is_improving") == True)
            worsening_count = sum(1 for d in data if d.get("is_improving") == False)
            total_analyzed = len(data)
            
            analysis_parts.append("#### Key Insights")
            analysis_parts.append("")
            
            # Trend insight
            if improving_count > worsening_count:
                analysis_parts.append(f"**Positive Momentum**: {improving_count}/{total_analyzed} districts are improving for {indicator_name}.")
            elif worsening_count > improving_count:
                analysis_parts.append(f"**Concerning Pattern**: {worsening_count}/{total_analyzed} districts show deteriorating trends for {indicator_name}.")
            else:
                analysis_parts.append(f"**Mixed Trends**: Equal numbers improving ({improving_count}) and worsening ({worsening_count}) for {indicator_name}.")
            
            return "\n".join(analysis_parts)
        
        return "No analysis available for this data structure."
        
    except Exception as e:
        return f"Error generating specific indicator analysis: {str(e)}"

def get_overall_sdg_goal_data(
    sdg_goal_number: int,
    year: int = 2021,
    query_type: str = "top_performers",
    top_n: int = 5,
    district_name: Optional[str] = None,
    state_name: Optional[str] = None,
    include_labels: bool = True
):
    """
    Get overall SDG goal performance data using percentile-based ranking across all indicators.
    This function uses performance percentiles for comprehensive SDG goal assessment.
    
    Parameters:
    - sdg_goal_number: SDG goal number (1-17)
    - year: 2016 or 2021
    - query_type: 'individual', 'top_performers', 'bottom_performers', 'trend'
    - top_n: Number of districts to return
    - district_name: Specific district for individual queries
    - state_name: Optional state filter
    - include_labels: Include descriptive labels
    """
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        
        # Get all indicators for this SDG goal (overall performance uses all indicators)
        cursor.execute("""
            SELECT sdg_short_indicator_name 
            FROM SDG_Goals 
            WHERE major_sdg_goal = %s
        """, (sdg_goal_number,))
        indicator_results = cursor.fetchall()
        indicator_names = [row[0] for row in indicator_results]
        
        if not indicator_names:
            return {
                "error": f"No indicators found for SDG Goal {sdg_goal_number}",
                "sdg_goal": sdg_goal_number
            }
        
        # Build the main query based on query type
        if query_type == "individual" and district_name:
            data = get_individual_district_data(cursor, sdg_goal_number, indicator_names, year, district_name, state_name)
        elif query_type == "top_performers":
            data = get_top_performers_data(cursor, sdg_goal_number, indicator_names, year, top_n, state_name)
        elif query_type == "bottom_performers":
            data = get_bottom_performers_data(cursor, sdg_goal_number, indicator_names, year, top_n, state_name)
        elif query_type == "trend":
            # Get both top and bottom performers
            top_data = get_top_performers_data(cursor, sdg_goal_number, indicator_names, year, top_n, state_name)
            bottom_data = get_bottom_performers_data(cursor, sdg_goal_number, indicator_names, year, top_n, state_name)
            data = {
                "top_performers": top_data.get("data", []),
                "bottom_performers": bottom_data.get("data", []),
                "combined_data": True
            }
        else:
            # Default to top performers
            data = get_top_performers_data(cursor, sdg_goal_number, indicator_names, year, top_n, state_name)
        
        cursor.close()
        conn.close()
        
        # Get boundary data for districts
        boundary_data = []
        if isinstance(data, dict):
            if isinstance(data.get("data"), list):
                district_names = [item.get("district") for item in data["data"] if isinstance(item, dict) and item.get("district")]
                boundary_data = get_district_boundary_data(district_names)
            elif data.get("combined_data"):
                # For trend data, get boundaries for both top and bottom
                top_districts = [item.get("district") for item in data.get("top_performers", []) if isinstance(item, dict) and item.get("district")]
                bottom_districts = [item.get("district") for item in data.get("bottom_performers", []) if isinstance(item, dict) and item.get("district")]
                all_districts = list(set(top_districts + bottom_districts))
                boundary_data = get_district_boundary_data(all_districts)
        
        # Format response
        response_data = {
            "sdg_goal": sdg_goal_number,
            "indicators": indicator_names,
            "year": year,
            "query_type": query_type,
            "data": data.get("data") if isinstance(data, dict) and not data.get("combined_data") else data,
            "boundary": boundary_data,
            "map_type": "overall_sdg_analysis",
            "analysis_type": "overall_sdg_goal",
            "total_districts": (len(data.get("data", [])) if isinstance(data, dict) and not data.get("combined_data") else 
                              (len(data.get("top_performers", [])) + len(data.get("bottom_performers", [])) if isinstance(data, dict) else 0))
        }
        
        return format_sdg_goal_response(response_data)
        
    except Exception as e:
        return {"error": f"Error retrieving overall SDG goal data: {str(e)}"} 

def calculate_overall_annual_change(district_indicators):
    """
    Calculate aggregated annual change for overall SDG performance.
    This provides a more representative view than using just the primary indicator.
    
    Methods:
    1. Average change across all indicators
    2. Weighted by indicator importance (if available)
    3. Normalized to account for different indicator directions
    """
    if not district_indicators:
        return None, "No indicators available"
    
    valid_changes = []
    improvement_count = 0
    deterioration_count = 0
    total_indicators = len(district_indicators)
    
    for indicator in district_indicators:
        annual_change = indicator.get("annual_change")
        change_interp = indicator.get("change_interpretation", {})
        
        if annual_change is not None:
            valid_changes.append(annual_change)
            
            # Count improvements vs deteriorations
            if change_interp.get("is_improvement") is True:
                improvement_count += 1
            elif change_interp.get("is_improvement") is False:
                deterioration_count += 1
    
    if not valid_changes:
        return None, "No valid annual change data"
    
    # Calculate aggregated metrics
    avg_change = sum(valid_changes) / len(valid_changes)
    improvement_ratio = improvement_count / total_indicators if total_indicators > 0 else 0
    
    # Determine overall trend interpretation
    if improvement_ratio >= 0.6:  # 60% or more improving
        overall_interpretation = "improvement"
        trend_description = f"Overall improving trend ({improvement_count}/{total_indicators} indicators improving)"
        trend_icon = "↗️"
        is_improving = True
    elif improvement_ratio <= 0.4:  # 60% or more deteriorating
        overall_interpretation = "deterioration" 
        trend_description = f"Overall concerning trend ({deterioration_count}/{total_indicators} indicators deteriorating)"
        trend_icon = "↘️"
        is_improving = False
    else:  # Mixed results
        overall_interpretation = "mixed"
        trend_description = f"Mixed trends ({improvement_count} improving, {deterioration_count} deteriorating)"
        trend_icon = "↔️"
        is_improving = None
    
    return avg_change, {
        "interpretation": overall_interpretation,
        "is_improvement": is_improving,
        "description": trend_description,
        "trend_icon": trend_icon,
        "improvement_count": improvement_count,
        "deterioration_count": deterioration_count,
        "total_indicators": total_indicators,
        "improvement_ratio": improvement_ratio,
        "average_change": avg_change
    }

def extract_district_name_from_query(user_query: str):
    """
    Extract district name from user query using fuzzy matching against database.
    """
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        
        # Get all district names from database
        cursor.execute("SELECT DISTINCT district_name FROM District_State ORDER BY district_name")
        db_districts = [row[0] for row in cursor.fetchall()]
        
        cursor.close()
        conn.close()
        
        # Try fuzzy matching
        best_match = process.extractOne(user_query, db_districts, score_cutoff=70)
        
        if best_match:
            return best_match[0]
        
        # If no good match, try word-by-word matching
        query_words = user_query.lower().split()
        for word in query_words:
            if len(word) > 3:  # Avoid short words
                match = process.extractOne(word, db_districts, score_cutoff=80)
                if match:
                    return match[0]
        
        return None
        
    except Exception as e:
        print(f"Error extracting district name: {e}")
        return None

def get_individual_district_sdg_data(
    district_name: str,
    sdg_goal_number: Optional[int] = None,
    indicator_names: Optional[List[str]] = None,
    year: int = 2021,
    state_name: Optional[str] = None
):
    """
    Get comprehensive SDG data for a specific district.
    
    Parameters:
    - district_name: Name of the district
    - sdg_goal_number: Optional SDG goal number (1-17), if None returns all goals
    - indicator_names: Optional list of specific indicators, if None returns all indicators for the goal
    - year: 2016 or 2021
    - state_name: Optional state filter for validation
    """
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        
        # First, find the exact district name using fuzzy matching
        resolved_district = extract_district_name_from_query(district_name)
        if not resolved_district:
            return {
                "error": f"District '{district_name}' not found in database",
                "suggestion": "Please check the district name spelling or try a different format"
            }
        
        # Validate state if provided
        if state_name:
            cursor.execute("""
                SELECT state_name FROM District_State 
                WHERE district_name = %s AND state_name ILIKE %s
            """, (resolved_district, f"%{state_name}%"))
            state_result = cursor.fetchone()
            if not state_result:
                return {
                    "error": f"District '{resolved_district}' not found in state '{state_name}'",
                    "district_found": resolved_district
                }
        
        # Get district's state
        cursor.execute("""
            SELECT state_name FROM District_State WHERE district_name = %s
        """, (resolved_district,))
        state_result = cursor.fetchone()
        district_state = state_result[0] if state_result else "Unknown"
        
        # Build query based on parameters
        base_conditions = ["sgd.district_name = %s"]
        params = [resolved_district]
        
        # Add SDG goal filter if specified
        if sdg_goal_number:
            base_conditions.append("sg.major_sdg_goal = %s")
            params.append(sdg_goal_number)
        
        # Add indicator filter if specified
        if indicator_names:
            indicator_placeholders = ','.join(['%s'] * len(indicator_names))
            base_conditions.append(f"sg.sdg_short_indicator_name IN ({indicator_placeholders})")
            params.extend(indicator_names)
        
        # Determine year column
        year_column = "sgd.nfhs_value_5" if year == 2021 else "sgd.nfhs_value_4"
        base_conditions.append(f"{year_column} IS NOT NULL")
        
        # Main query
        query = f"""
        SELECT 
            sg.major_sdg_goal,
            sg.sdg_short_indicator_name,
            sg.sdg_full_indicator_name,
            sg.sdg_indicator_number,
            sgd.nfhs_value_4,
            sgd.nfhs_value_5,
            sgd.actual_annual_change,
            sgd.aspirational_status,
            sgd.district_sdg_status,
            COALESCE(sg.indicator_direction, 'lower_is_better') as direction,
            COALESCE(sg.higher_is_better, FALSE) as higher_is_better
        FROM SDG_Goals_Data sgd
        JOIN SDG_Goals sg ON sgd.sdg_short_indicator_name = sg.sdg_short_indicator_name
        WHERE {' AND '.join(base_conditions)}
        ORDER BY sg.major_sdg_goal, sg.sdg_indicator_number
        """
        
        cursor.execute(query, params)
        results = cursor.fetchall()
        
        if not results:
            error_msg = f"No data found for district '{resolved_district}'"
            if sdg_goal_number:
                error_msg += f" for SDG Goal {sdg_goal_number}"
            if indicator_names:
                error_msg += f" for indicators: {', '.join(indicator_names)}"
            return {"error": error_msg}
        
        # Organize data by SDG goal
        sdg_goals_data = {}
        all_indicators = []
        
        for row in results:
            sdg_goal = row[0]
            indicator_name = row[1]
            indicator_full_name = row[2]
            indicator_number = row[3]
            nfhs_4_value = row[4]
            nfhs_5_value = row[5]
            annual_change = row[6]
            aspirational_status = row[7]
            district_sdg_status = row[8]
            direction = row[9]
            higher_is_better = row[10]
            
            # Get current value based on year
            current_value = nfhs_5_value if year == 2021 else nfhs_4_value
            
            # Enhanced change interpretation
            change_interpretation = interpret_annual_change_enhanced(annual_change, direction)
            
            indicator_data = {
                "indicator_name": indicator_name,
                "indicator_full_name": indicator_full_name,
                "indicator_number": indicator_number,
                "nfhs_4_value": float(nfhs_4_value) if nfhs_4_value is not None else None,
                "nfhs_5_value": float(nfhs_5_value) if nfhs_5_value is not None else None,
                "current_value": float(current_value) if current_value is not None else None,
                "annual_change": float(annual_change) if annual_change is not None else None,
                "direction": direction,
                "higher_is_better": higher_is_better,
                "change_interpretation": change_interpretation,
                "aspirational_status": aspirational_status,
                "district_sdg_status": district_sdg_status
            }
            
            # Group by SDG goal
            if sdg_goal not in sdg_goals_data:
                sdg_goals_data[sdg_goal] = {
                    "sdg_goal": sdg_goal,
                    "indicators": [],
                    "total_indicators": 0,
                    "improving_indicators": 0,
                    "deteriorating_indicators": 0
                }
            
            sdg_goals_data[sdg_goal]["indicators"].append(indicator_data)
            sdg_goals_data[sdg_goal]["total_indicators"] += 1
            
            # Count improvement trends
            if change_interpretation.get("is_improvement") == True:
                sdg_goals_data[sdg_goal]["improving_indicators"] += 1
            elif change_interpretation.get("is_improvement") == False:
                sdg_goals_data[sdg_goal]["deteriorating_indicators"] += 1
            
            all_indicators.append(indicator_data)
        
        # Calculate overall performance summary
        total_indicators = len(all_indicators)
        improving_count = sum(1 for ind in all_indicators if ind["change_interpretation"].get("is_improvement") == True)
        deteriorating_count = sum(1 for ind in all_indicators if ind["change_interpretation"].get("is_improvement") == False)
        
        # Get boundary data for the district
        boundary_data = get_district_boundary_data([resolved_district])
        
        cursor.close()
        conn.close()
        
        # Format response
        response_data = {
            "success": True,
            "district": resolved_district,
            "state": district_state,
            "year": year,
            "sdg_goals_data": list(sdg_goals_data.values()),
            "summary": {
                "total_indicators": total_indicators,
                "improving_indicators": improving_count,
                "deteriorating_indicators": deteriorating_count,
                "stable_indicators": total_indicators - improving_count - deteriorating_count,
                "improvement_rate": round((improving_count / total_indicators) * 100, 1) if total_indicators > 0 else 0,
                "sdg_goals_covered": len(sdg_goals_data)
            },
            "boundary": boundary_data,
            "map_type": "individual_district_analysis",
            "analysis_type": "individual_district",
            # For backward compatibility
            "data": all_indicators if not sdg_goal_number else sdg_goals_data.get(sdg_goal_number, {}).get("indicators", []),
            "indicators": [ind["indicator_name"] for ind in all_indicators],
            "district_data": {
                "district": resolved_district,
                "state": district_state,
                "aspirational_status": results[0][7] if results else None,
                "district_sdg_status": results[0][8] if results else None
            }
        }
        
        return response_data
        
    except Exception as e:
        return {"error": f"Error retrieving individual district data: {str(e)}"}

def get_district_indicator_selection_prompt(district_name: str, sdg_goal_number: int):
    """
    Generate a response prompting user to select indicators for a specific district and SDG goal.
    """
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        
        # Resolve district name
        resolved_district = extract_district_name_from_query(district_name)
        if not resolved_district:
            return {
                "error": f"District '{district_name}' not found",
                "message": "Please check the district name spelling"
            }
        
        # Get available indicators for the SDG goal and district
        cursor.execute("""
            SELECT 
                sg.sdg_short_indicator_name,
                sg.sdg_full_indicator_name,
                sg.sdg_indicator_number,
                COUNT(*) as data_availability
            FROM SDG_Goals sg
            LEFT JOIN SDG_Goals_Data sgd ON sg.sdg_short_indicator_name = sgd.sdg_short_indicator_name
                AND sgd.district_name = %s
                AND (sgd.nfhs_value_4 IS NOT NULL OR sgd.nfhs_value_5 IS NOT NULL)
            WHERE sg.major_sdg_goal = %s
            GROUP BY sg.sdg_short_indicator_name, sg.sdg_full_indicator_name, sg.sdg_indicator_number
            ORDER BY sg.sdg_indicator_number
        """, (resolved_district, sdg_goal_number))
        
        results = cursor.fetchall()
        cursor.close()
        conn.close()
        
        if not results:
            return {
                "error": f"No indicators found for SDG Goal {sdg_goal_number} in district {resolved_district}",
                "district": resolved_district,
                "sdg_goal": sdg_goal_number
            }
        
        # Format indicators with availability info
        available_indicators = []
        for row in results:
            available_indicators.append({
                "short_name": row[0],
                "full_name": row[1],
                "indicator_number": row[2],
                "has_data": row[3] > 0
            })
        
        # Get district state
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT state_name FROM District_State WHERE district_name = %s", (resolved_district,))
        state_result = cursor.fetchone()
        district_state = state_result[0] if state_result else "Unknown"
        cursor.close()
        conn.close()
        
        return {
            "needs_indicator_selection": True,
            "district": resolved_district,
            "state": district_state,
            "sdg_goal": sdg_goal_number,
            "available_indicators": available_indicators,
            "total_indicators": len(available_indicators),
            "indicators_with_data": len([ind for ind in available_indicators if ind["has_data"]]),
            "message": f"I found {len(available_indicators)} indicators for SDG Goal {sdg_goal_number} in {resolved_district}, {district_state}. Please select which indicator(s) you'd like to analyze:",
            "selection_options": [
                "Choose specific indicator(s) from the list",
                "Analyze all indicators",
                "Focus on indicators with available data only"
            ]
        }
        
    except Exception as e:
        return {"error": f"Error getting indicator selection prompt: {str(e)}"}

def get_best_worst_district_for_indicator(
    sdg_goal_number: Optional[int] = None,
    indicator_name: Optional[str] = None,
    query_type: str = "best",  # "best" or "worst"
    year: int = 2021,
    state_name: Optional[str] = None
):
    """
    Find the best or worst performing district for a specific SDG goal or indicator.
    
    Parameters:
    - sdg_goal_number: SDG goal number (1-17)
    - indicator_name: Specific indicator name (optional)
    - query_type: "best" for best performing, "worst" for worst performing
    - year: 2016 or 2021
    - state_name: Optional state filter
    """
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        
        # If indicator is specified, resolve it
        resolved_indicator = None
        if indicator_name:
            resolved_indicator = fuzzy_match_indicator(indicator_name, sdg_goal_number)
            if not resolved_indicator:
                return {
                    "error": f"Indicator '{indicator_name}' not found" + (f" for SDG Goal {sdg_goal_number}" if sdg_goal_number else ""),
                    "suggestion": "Please check the indicator name or try a different format"
                }
        
        # Build query conditions
        conditions = []
        params = []
        
        if sdg_goal_number:
            conditions.append("sg.major_sdg_goal = %s")
            params.append(sdg_goal_number)
        
        if resolved_indicator:
            conditions.append("sg.sdg_short_indicator_name = %s")
            params.append(resolved_indicator)
        
        if state_name:
            conditions.append("ds.state_name ILIKE %s")
            params.append(f"%{state_name}%")
        
        # Determine year column
        year_column = "sgd.nfhs_value_5" if year == 2021 else "sgd.nfhs_value_4"
        conditions.append(f"{year_column} IS NOT NULL")
        
        # If no specific indicator, use overall SDG performance (percentile-based)
        if not resolved_indicator and sdg_goal_number:
            return get_best_worst_district_overall_sdg(sdg_goal_number, query_type, year, state_name)
        
        # For specific indicator, get actual values
        order_direction = "ASC" if query_type == "best" else "DESC"
        
        # Get indicator direction to determine proper ordering
        cursor.execute("""
            SELECT COALESCE(higher_is_better, FALSE) 
            FROM SDG_Goals 
            WHERE sdg_short_indicator_name = %s
        """, (resolved_indicator,))
        direction_result = cursor.fetchone()
        higher_is_better = direction_result[0] if direction_result else False
        
        # Adjust ordering based on indicator direction
        if (query_type == "best" and not higher_is_better) or (query_type == "worst" and higher_is_better):
            order_direction = "ASC"  # Lower is better for best, or higher is better for worst
        else:
            order_direction = "DESC"  # Higher is better for best, or lower is better for worst
        
        query = f"""
        SELECT 
            sgd.district_name,
            ds.state_name,
            sg.sdg_short_indicator_name,
            sg.sdg_full_indicator_name,
            {year_column} as indicator_value,
            sgd.nfhs_value_4,
            sgd.nfhs_value_5,
            sgd.actual_annual_change,
            sgd.aspirational_status,
            sgd.district_sdg_status,
            COALESCE(sg.indicator_direction, 'lower_is_better') as direction,
            COALESCE(sg.higher_is_better, FALSE) as higher_is_better
        FROM SDG_Goals_Data sgd
        JOIN SDG_Goals sg ON sgd.sdg_short_indicator_name = sg.sdg_short_indicator_name
        JOIN District_State ds ON sgd.district_name = ds.district_name
        WHERE {' AND '.join(conditions)}
        ORDER BY {year_column} {order_direction}
        LIMIT 1
        """
        
        cursor.execute(query, params)
        result = cursor.fetchone()
        
        if not result:
            error_msg = f"No data found"
            if sdg_goal_number:
                error_msg += f" for SDG Goal {sdg_goal_number}"
            if resolved_indicator:
                error_msg += f" for indicator '{resolved_indicator}'"
            if state_name:
                error_msg += f" in state '{state_name}'"
            return {"error": error_msg}
        
        # Process result
        district_name = result[0]
        state = result[1]
        indicator_name = result[2]
        indicator_full_name = result[3]
        indicator_value = result[4]
        nfhs_4_value = result[5]
        nfhs_5_value = result[6]
        annual_change = result[7]
        aspirational_status = result[8]
        district_sdg_status = result[9]
        direction = result[10]
        higher_is_better = result[11]
        
        # Enhanced change interpretation
        change_interpretation = interpret_annual_change_enhanced(annual_change, direction)
        
        # Get boundary data
        boundary_data = get_district_boundary_data([district_name])
        
        cursor.close()
        conn.close()
        
        # Format response
        performance_type = "Best" if query_type == "best" else "Worst"
        
        response_data = {
            "success": True,
            "query_type": query_type,
            "performance_type": performance_type,
            "district": district_name,
            "state": state,
            "indicator_name": indicator_name,
            "indicator_full_name": indicator_full_name,
            "indicator_value": float(indicator_value) if indicator_value is not None else None,
            "nfhs_4_value": float(nfhs_4_value) if nfhs_4_value is not None else None,
            "nfhs_5_value": float(nfhs_5_value) if nfhs_5_value is not None else None,
            "annual_change": float(annual_change) if annual_change is not None else None,
            "change_interpretation": change_interpretation,
            "aspirational_status": aspirational_status,
            "district_sdg_status": district_sdg_status,
            "direction": direction,
            "higher_is_better": higher_is_better,
            "year": year,
            "sdg_goal": sdg_goal_number,
            "boundary": boundary_data,
            "map_type": "best_worst_district_analysis",
            "analysis_type": "best_worst_district",
            # For compatibility
            "data": [{
                "district": district_name,
                "state": state,
                "indicator_value": float(indicator_value) if indicator_value is not None else None,
                "nfhs_4_value": float(nfhs_4_value) if nfhs_4_value is not None else None,
                "nfhs_5_value": float(nfhs_5_value) if nfhs_5_value is not None else None,
                "annual_change": float(annual_change) if annual_change is not None else None,
                "change_interpretation": change_interpretation,
                "aspirational_status": aspirational_status,
                "district_sdg_status": district_sdg_status
            }]
        }
        
        return response_data
        
    except Exception as e:
        return {"error": f"Error finding {query_type} performing district: {str(e)}"}

def get_best_worst_district_overall_sdg(sdg_goal_number: int, query_type: str, year: int, state_name: Optional[str]):
    """
    Find best/worst district for overall SDG goal performance using percentile ranking.
    """
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        
        # Get all indicators for this SDG goal
        cursor.execute("""
            SELECT sdg_short_indicator_name 
            FROM SDG_Goals 
            WHERE major_sdg_goal = %s
        """, (sdg_goal_number,))
        indicator_results = cursor.fetchall()
        indicator_names = [row[0] for row in indicator_results]
        
        if not indicator_names:
            return {
                "error": f"No indicators found for SDG Goal {sdg_goal_number}",
                "sdg_goal": sdg_goal_number
            }
        
        # Use existing functions with top_n=1
        if query_type == "best":
            data = get_top_performers_data(cursor, sdg_goal_number, indicator_names, year, 1, state_name)
        else:  # worst
            data = get_bottom_performers_data(cursor, sdg_goal_number, indicator_names, year, 1, state_name)
        
        cursor.close()
        conn.close()
        
        if not data.get("data") or len(data["data"]) == 0:
            return {"error": f"No data found for SDG Goal {sdg_goal_number}"}
        
        district_data = data["data"][0]
        district_name = district_data.get("district")
        
        # Get boundary data
        boundary_data = get_district_boundary_data([district_name]) if district_name else []
        
        # Format response
        performance_type = "Best" if query_type == "best" else "Worst"
        
        response_data = {
            "success": True,
            "query_type": query_type,
            "performance_type": performance_type,
            "sdg_goal": sdg_goal_number,
            "analysis_type": "overall_sdg_performance",
            "district": district_name,
            "state": district_data.get("state"),
            "performance_percentile": district_data.get("performance_percentile"),
            "indicators_available": district_data.get("indicators_available"),
            "annual_change": district_data.get("annual_change"),
            "change_interpretation": district_data.get("overall_trend_analysis"),
            "aspirational_status": district_data.get("aspirational_status"),
            "district_sdg_status": district_data.get("district_sdg_status"),
            "indicators": district_data.get("indicators", []),
            "year": year,
            "boundary": boundary_data,
            "map_type": "best_worst_overall_sdg",
            "data": data["data"]
        }
        
        return response_data
        
    except Exception as e:
        return {"error": f"Error finding {query_type} overall SDG performance: {str(e)}"}

def get_aac_classification(
    sdg_goal_number: int,
    year: int = 2021,
    state_name: Optional[str] = None,
    classification_method: str = "quantile",  # "quantile" or "natural_breaks"
    default_indicator: Optional[str] = None
):
    """
    Get comprehensive AAC (Annual Average Change) classification data for all indicators within an SDG goal.
    This function provides all indicator data at once, allowing frontend to show
    AAC-based classification for any indicator with dropdown selection.
    
    Parameters:
    - sdg_goal_number: SDG goal number (1-17)
    - year: 2016 or 2021 (determines which NFHS data to use)
    - state_name: Optional state filter (None for all India)
    - classification_method: 'quantile' (4 equal groups) or 'natural_breaks' (Jenks breaks)
    - default_indicator: Which indicator to show first (if None, uses first available)
    """
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        
        # Get all indicators for this SDG goal
        cursor.execute("""
            SELECT sdg_short_indicator_name, sdg_full_indicator_name, sdg_indicator_number
            FROM SDG_Goals 
            WHERE major_sdg_goal = %s
            ORDER BY sdg_indicator_number
        """, (sdg_goal_number,))
        
        indicator_results = cursor.fetchall()
        if not indicator_results:
            return {
                "success": False,
                "error": f"No indicators found for SDG Goal {sdg_goal_number}",
                "data": []
            }
        
        available_indicators = []
        indicator_data_map = {}
        all_districts_data = []
        
        # Build state filter
        state_filter = ""
        base_params = []
        if state_name:
            state_filter = "AND ds.state_name ILIKE %s"
            base_params.append(f"%{state_name}%")
        
        # Determine year column
        year_column = "sgd.nfhs_value_5" if year == 2021 else "sgd.nfhs_value_4"
        
        # Process each indicator
        for indicator_row in indicator_results:
            indicator_short_name = indicator_row[0]
            indicator_full_name = indicator_row[1]
            indicator_number = indicator_row[2]
            
            # Get district data for this indicator
            params = [indicator_short_name] + base_params
            
            query = f"""
            SELECT 
                sgd.district_name,
                ds.state_name,
                {year_column} as indicator_value,
                sgd.nfhs_value_4,
                sgd.nfhs_value_5,
                sgd.actual_annual_change,
                sgd.aspirational_status,
                sgd.district_sdg_status,
                dg.district_name as has_geometry,
                COALESCE(sg.indicator_direction, 'lower_is_better') as direction,
                COALESCE(sg.higher_is_better, FALSE) as higher_is_better
            FROM SDG_Goals_Data sgd
            JOIN SDG_Goals sg ON sgd.sdg_short_indicator_name = sg.sdg_short_indicator_name
            JOIN District_State ds ON sgd.district_name = ds.district_name
            LEFT JOIN District_Geometry dg ON sgd.district_name = dg.district_name
            WHERE sgd.sdg_short_indicator_name = %s
            AND {year_column} IS NOT NULL
            AND sgd.actual_annual_change IS NOT NULL
            {state_filter}
            ORDER BY ds.state_name, sgd.district_name
            """
            
            cursor.execute(query, params)
            results = cursor.fetchall()
            
            if results:
                # Add to available indicators
                district_count = len(results)
                available_indicators.append({
                    "short_name": indicator_short_name,
                    "full_name": indicator_full_name,
                    "indicator_number": indicator_number,
                    "district_count": district_count
                })
                
                # Extract AAC values for classification thresholds
                aac_values = [float(row[5]) for row in results if row[5] is not None]
                
                # Calculate classification thresholds based on method
                thresholds = None
                if aac_values:
                    if classification_method == "quantile":
                        # Use quartiles for 4 equal groups
                        q1 = np.percentile(aac_values, 25)
                        q2 = np.percentile(aac_values, 50) 
                        q3 = np.percentile(aac_values, 75)
                        thresholds = {"q1": q1, "q2": q2, "q3": q3}
                    else:  # natural_breaks - simplified implementation
                        # For now, use quantiles but could implement Jenks natural breaks
                        sorted_values = sorted(aac_values)
                        n = len(sorted_values)
                        q1 = sorted_values[n//4] if n >= 4 else sorted_values[0]
                        q2 = sorted_values[n//2] if n >= 2 else sorted_values[0]
                        q3 = sorted_values[3*n//4] if n >= 4 else sorted_values[-1]
                        thresholds = {"q1": q1, "q2": q2, "q3": q3}
                
                # Define AAC classification functions
                def get_aac_category(aac_value, thresholds, higher_is_better):
                    if not thresholds or aac_value is None:
                        return {"category": "No Data", "color": "#757575", "level": 0}
                    
                    # For indicators where higher is better (like coverage indicators)
                    if higher_is_better:
                        if aac_value >= thresholds["q3"]:
                            return {"category": "Rapidly Improving", "color": "#1a5d1a", "level": 4}
                        elif aac_value >= thresholds["q2"]:
                            return {"category": "Improving", "color": "#2d8f2d", "level": 3}
                        elif aac_value >= thresholds["q1"]:
                            return {"category": "Slowly Improving", "color": "#ffa500", "level": 2}
                        else:
                            return {"category": "Declining", "color": "#d32f2f", "level": 1}
                    else:
                        # For indicators where lower is better (like mortality, disease rates)
                        # Negative change is good (improvement)
                        if aac_value <= thresholds["q1"]:
                            return {"category": "Rapidly Improving", "color": "#1a5d1a", "level": 4}
                        elif aac_value <= thresholds["q2"]:
                            return {"category": "Improving", "color": "#2d8f2d", "level": 3}
                        elif aac_value <= thresholds["q3"]:
                            return {"category": "Slowly Improving", "color": "#ffa500", "level": 2}
                        else:
                            return {"category": "Worsening", "color": "#d32f2f", "level": 1}
                
                # Process districts for this indicator
                classified_districts = []
                classification_summary = {}
                higher_is_better = results[0][10] if results else False
                
                for row in results:
                    annual_change = row[5]
                    direction = row[9]
                    
                    # Enhanced change interpretation
                    change_interpretation = interpret_annual_change_enhanced(annual_change, direction)
                    
                    district_data = {
                        "district": row[0],
                        "state": row[1],
                        "indicator_value": float(row[2]) if row[2] is not None else None,
                        "nfhs_4_value": float(row[3]) if row[3] is not None else None,
                        "nfhs_5_value": float(row[4]) if row[4] is not None else None,
                        "annual_change": float(annual_change) if annual_change is not None else None,
                        "aspirational_status": row[6],
                        "district_sdg_status": row[7],
                        "has_geometry": row[8] is not None,
                        "direction": direction,
                        "higher_is_better": higher_is_better,
                        "change_interpretation": change_interpretation
                    }
                    
                    # Apply AAC-based classification
                    classification = get_aac_category(district_data["annual_change"], thresholds, higher_is_better)
                    district_data.update(classification)
                    classified_districts.append(district_data)
                    
                    # Update summary
                    cat = classification["category"]
                    if cat not in classification_summary:
                        classification_summary[cat] = {"count": 0, "color": classification["color"]}
                    classification_summary[cat]["count"] += 1
                
                # Sort by classification level (best first)
                classified_districts.sort(key=lambda x: x["level"], reverse=True)
                
                # Store data for this indicator
                indicator_data_map[indicator_short_name] = {
                    "indicator_name": indicator_short_name,
                    "indicator_full_name": indicator_full_name,
                    "indicator_number": indicator_number,
                    "data": classified_districts,
                    "classification_summary": classification_summary,
                    "total_districts": len(classified_districts),
                    "thresholds": thresholds,
                    "higher_is_better": higher_is_better,
                    "classification_method": classification_method
                }
                
                # Collect all districts for boundary data (avoiding duplicates)
                for district in classified_districts:
                    if district["has_geometry"] and not any(d["district"] == district["district"] for d in all_districts_data):
                        all_districts_data.append({
                            "district": district["district"],
                            "state": district["state"]
                        })
        
        cursor.close()
        conn.close()
        
        if not available_indicators:
            return {
                "success": False,
                "error": f"No data found for SDG Goal {sdg_goal_number}" + (f" in {state_name}" if state_name else ""),
                "available_indicators": [],
                "data": []
            }
        
        # Determine default indicator if not specified
        if not default_indicator or default_indicator not in indicator_data_map:
            default_indicator = available_indicators[0]["short_name"]
        
        # Get boundary data for all districts
        boundary_data = []
        if all_districts_data:
            district_names = [d["district"] for d in all_districts_data]
            boundary_data = get_district_boundary_data(district_names)
        
        # Get state coverage summary for default indicator
        default_data = indicator_data_map[default_indicator]
        state_summary = {}
        for district in default_data["data"]:
            state = district["state"]
            if state not in state_summary:
                state_summary[state] = {"total": 0, "categories": {}}
            state_summary[state]["total"] += 1
            
            cat = district["category"]
            if cat not in state_summary[state]["categories"]:
                state_summary[state]["categories"][cat] = 0
            state_summary[state]["categories"][cat] += 1
        
        return {
            "success": True,
            "sdg_goal": sdg_goal_number,
            "year": year,
            "state_name": state_name,
            "classification_type": "aac",
            "classification_method": classification_method,
            "available_indicators": available_indicators,
            "indicator_data_map": indicator_data_map,
            "default_indicator": default_indicator,
            "current_indicator": default_indicator,
            # For compatibility with existing frontend components
            "indicator_name": default_data["indicator_name"],
            "indicator_full_name": default_data["indicator_full_name"],
            "data": default_data["data"],
            "classification_summary": default_data["classification_summary"],
            "total_districts": default_data["total_districts"],
            "boundary": boundary_data,
            "state_summary": state_summary,
            "districts_with_boundaries": len(boundary_data),
            "map_type": "aac_classification",
            "coverage_info": {
                "total_districts_with_data": default_data["total_districts"],
                "districts_with_geometry": len([d for d in default_data["data"] if d.get("has_geometry")]),
                "coverage_percentage": round((len(boundary_data) / default_data["total_districts"]) * 100, 1) if default_data["total_districts"] > 0 else 0
            },
            "thresholds": default_data.get("thresholds")
        }
        
    except Exception as e:
        return {
            "success": False,
            "error": f"Error in AAC classification: {str(e)}",
            "available_indicators": [],
            "data": []
        }

def get_state_wise_summary(
    sdg_goal_number: Optional[int] = None,
    indicator_names: Optional[List[str]] = None,
    year: int = 2021,
    top_n: int = 10,
    sort_by: str = "average_performance"  # "average_performance", "improvement_rate", "district_count"
):
    """
    Get state-wise aggregated summary of SDG performance.
    
    Parameters:
    - sdg_goal_number: Optional SDG goal number (1-17)
    - indicator_names: Optional list of specific indicators
    - year: 2016 or 2021
    - top_n: Number of states to return
    - sort_by: How to sort states ("average_performance", "improvement_rate", "district_count")
    """
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        
        # Build base conditions
        conditions = []
        params = []
        
        if sdg_goal_number:
            conditions.append("sg.major_sdg_goal = %s")
            params.append(sdg_goal_number)
        
        if indicator_names:
            indicator_placeholders = ','.join(['%s'] * len(indicator_names))
            conditions.append(f"sg.sdg_short_indicator_name IN ({indicator_placeholders})")
            params.extend(indicator_names)
        
        # Determine year column
        year_column = "sgd.nfhs_value_5" if year == 2021 else "sgd.nfhs_value_4"
        conditions.append(f"{year_column} IS NOT NULL")
        conditions.append("sgd.actual_annual_change IS NOT NULL")
        
        base_condition = " AND ".join(conditions) if conditions else "1=1"
        
        # Main aggregation query
        query = f"""
        WITH state_district_counts AS (
            SELECT 
                ds.state_name,
                COUNT(DISTINCT sgd.district_name) as total_districts
            FROM SDG_Goals_Data sgd
            JOIN SDG_Goals sg ON sgd.sdg_short_indicator_name = sg.sdg_short_indicator_name
            JOIN District_State ds ON sgd.district_name = ds.district_name
            WHERE {base_condition}
            GROUP BY ds.state_name
        ),
        state_indicator_summary AS (
            SELECT 
                ds.state_name,
                sg.sdg_short_indicator_name,
                sg.sdg_full_indicator_name,
                sg.major_sdg_goal,
                COALESCE(sg.higher_is_better, FALSE) as higher_is_better,
                COUNT(*) as district_count,
                AVG({year_column}) as avg_indicator_value,
                MIN({year_column}) as best_value,
                MAX({year_column}) as worst_value,
                AVG(sgd.actual_annual_change) as avg_annual_change,
                COUNT(CASE WHEN sgd.actual_annual_change > 0 AND sg.higher_is_better = TRUE THEN 1
                           WHEN sgd.actual_annual_change < 0 AND sg.higher_is_better = FALSE THEN 1 END) as improving_districts,
                COUNT(CASE WHEN sgd.aspirational_status = 'Aspirational' THEN 1 END) as aspirational_districts,
                -- Performance percentile calculation
                CASE 
                    WHEN COALESCE(sg.higher_is_better, FALSE) = TRUE THEN 
                        PERCENT_RANK() OVER (PARTITION BY sg.sdg_short_indicator_name ORDER BY AVG({year_column}) DESC) * 100
                    ELSE 
                        PERCENT_RANK() OVER (PARTITION BY sg.sdg_short_indicator_name ORDER BY AVG({year_column}) ASC) * 100
                END as performance_percentile
            FROM SDG_Goals_Data sgd
            JOIN SDG_Goals sg ON sgd.sdg_short_indicator_name = sg.sdg_short_indicator_name
            JOIN District_State ds ON sgd.district_name = ds.district_name
            WHERE {base_condition}
            GROUP BY ds.state_name, sg.sdg_short_indicator_name, sg.sdg_full_indicator_name, 
                     sg.major_sdg_goal, sg.higher_is_better
        ),
        state_overall_summary AS (
            SELECT 
                sis.state_name,
                COUNT(DISTINCT sis.sdg_short_indicator_name) as indicators_analyzed,
                COUNT(DISTINCT sis.major_sdg_goal) as sdg_goals_covered,
                -- Fix: Get actual distinct district count per state
                sdc.total_districts,
                AVG(sis.performance_percentile) as avg_performance_percentile,
                AVG(sis.avg_annual_change) as overall_improvement_rate,
                SUM(sis.improving_districts) as total_improving_districts,
                SUM(sis.aspirational_districts) as total_aspirational_districts,
                -- Best and worst indicators for each state
                (SELECT sdg_short_indicator_name FROM state_indicator_summary sis2 
                 WHERE sis2.state_name = sis.state_name 
                 ORDER BY performance_percentile DESC LIMIT 1) as best_indicator,
                (SELECT sdg_short_indicator_name FROM state_indicator_summary sis2 
                 WHERE sis2.state_name = sis.state_name 
                 ORDER BY performance_percentile ASC LIMIT 1) as worst_indicator
            FROM state_indicator_summary sis
            JOIN state_district_counts sdc ON sis.state_name = sdc.state_name
            GROUP BY sis.state_name, sdc.total_districts
        )
        SELECT * FROM state_overall_summary
        ORDER BY 
            CASE 
                WHEN %s = 'average_performance' THEN avg_performance_percentile
                WHEN %s = 'improvement_rate' THEN overall_improvement_rate  
                WHEN %s = 'district_count' THEN total_districts
                ELSE avg_performance_percentile
            END DESC
        LIMIT %s
        """
        
        # Add duplicate parameters for the second base_condition usage
        params.extend(params.copy())
        
        # Add sort_by parameters
        params.extend([sort_by, sort_by, sort_by, top_n])
        
        cursor.execute(query, params)
        results = cursor.fetchall()
        
        if not results:
            return {
                "error": "No data found for the specified criteria",
                "sdg_goal": sdg_goal_number,
                "indicators": indicator_names
            }
        
        # Format results
        state_summaries = []
        for row in results:
            state_summary = {
                "state": row[0],
                "indicators_analyzed": int(row[1]),
                "sdg_goals_covered": int(row[2]),
                "total_districts": int(row[3]),
                "avg_performance_percentile": float(row[4]) if row[4] is not None else None,
                "overall_improvement_rate": float(row[5]) if row[5] is not None else None,
                "improving_districts": int(row[6]),
                "aspirational_districts": int(row[7]),
                "best_indicator": row[8],
                "worst_indicator": row[9],
                "improvement_percentage": round((row[6] / row[3]) * 100, 1) if row[3] > 0 else 0
            }
            state_summaries.append(state_summary)
        
        # Get detailed indicator data for top states
        top_states = [state["state"] for state in state_summaries[:3]]
        detailed_indicators = get_state_detailed_indicators(cursor, top_states, sdg_goal_number, indicator_names, year)
        
        # Get boundary data for all districts in the top-performing states
        # Since we don't have state-level boundaries, include all districts from these states
        # to collectively represent the state boundaries on the map
        
        if state_summaries:
            # Get all state names from the results
            top_state_names = [state["state"] for state in state_summaries]
            
            # Query to get all districts in these states
            state_placeholders = ','.join(['%s'] * len(top_state_names))
            district_query = f"""
            SELECT DISTINCT ds.district_name
            FROM District_State ds
            WHERE ds.state_name IN ({state_placeholders})
            ORDER BY ds.district_name
            """
            
            cursor.execute(district_query, top_state_names)
            district_results = cursor.fetchall()
            all_districts = [row[0] for row in district_results]
            
            boundary_data = get_district_boundary_data(all_districts) if all_districts else []
        else:
            boundary_data = []
        
        cursor.close()
        conn.close()
        
        return {
            "success": True,
            "analysis_type": "state_wise_summary",
            "sdg_goal": sdg_goal_number,
            "indicators": indicator_names,
            "year": year,
            "sort_by": sort_by,
            "total_states": len(state_summaries),
            "data": state_summaries,
            "detailed_indicators": detailed_indicators,
            "boundary_data": boundary_data,
            "summary": {
                "avg_performance_range": {
                    "highest": max(s["avg_performance_percentile"] for s in state_summaries if s["avg_performance_percentile"]),
                    "lowest": min(s["avg_performance_percentile"] for s in state_summaries if s["avg_performance_percentile"])
                },
                "total_districts_analyzed": sum(s["total_districts"] for s in state_summaries),
                "total_aspirational_districts": sum(s["aspirational_districts"] for s in state_summaries)
            },
            "map_type": "state_wise_analysis"
        }
        
    except Exception as e:
        return {"error": f"Error in state-wise summary: {str(e)}"}

def get_state_detailed_indicators(cursor, state_names, sdg_goal_number, indicator_names, year):
    """Get detailed indicator data for specific states."""
    try:
        if not state_names:
            return {}
        
        conditions = ["ds.state_name IN ({})".format(','.join(['%s'] * len(state_names)))]
        params = state_names.copy()
        
        if sdg_goal_number:
            conditions.append("sg.major_sdg_goal = %s")
            params.append(sdg_goal_number)
        
        if indicator_names:
            indicator_placeholders = ','.join(['%s'] * len(indicator_names))
            conditions.append(f"sg.sdg_short_indicator_name IN ({indicator_placeholders})")
            params.extend(indicator_names)
        
        year_column = "sgd.nfhs_value_5" if year == 2021 else "sgd.nfhs_value_4"
        conditions.append(f"{year_column} IS NOT NULL")
        
        query = f"""
        SELECT 
            ds.state_name,
            sg.sdg_short_indicator_name,
            sg.sdg_full_indicator_name,
            COUNT(*) as district_count,
            AVG({year_column}) as avg_value,
            MIN({year_column}) as best_value,
            MAX({year_column}) as worst_value,
            AVG(sgd.actual_annual_change) as avg_change,
            COALESCE(sg.higher_is_better, FALSE) as higher_is_better
        FROM SDG_Goals_Data sgd
        JOIN SDG_Goals sg ON sgd.sdg_short_indicator_name = sg.sdg_short_indicator_name
        JOIN District_State ds ON sgd.district_name = ds.district_name
        WHERE {' AND '.join(conditions)}
        GROUP BY ds.state_name, sg.sdg_short_indicator_name, sg.sdg_full_indicator_name, sg.higher_is_better
        ORDER BY ds.state_name, sg.sdg_short_indicator_name
        """
        
        cursor.execute(query, params)
        results = cursor.fetchall()
        
        # Organize by state
        state_details = {}
        for row in results:
            state_name = row[0]
            if state_name not in state_details:
                state_details[state_name] = []
            
            state_details[state_name].append({
                "indicator_name": row[1],
                "indicator_full_name": row[2],
                "district_count": int(row[3]),
                "avg_value": float(row[4]) if row[4] is not None else None,
                "best_value": float(row[5]) if row[5] is not None else None,
                "worst_value": float(row[6]) if row[6] is not None else None,
                "avg_annual_change": float(row[7]) if row[7] is not None else None,
                "higher_is_better": row[8],
                "performance_note": "Lower is better" if not row[8] else "Higher is better"
            })
        
        return state_details
        
    except Exception as e:
        print(f"Error getting state detailed indicators: {e}")
        return {}

def get_time_series_comparison(
    sdg_goal_number: Optional[int] = None,
    indicator_names: Optional[List[str]] = None,
    analysis_type: str = "district_trends",  # "district_trends", "state_trends", "top_improvers", "top_decliners"
    top_n: int = 10,
    state_name: Optional[str] = None
):
    """
    Analyze changes between NFHS-4 (2016) and NFHS-5 (2021) data.
    
    Parameters:
    - sdg_goal_number: Optional SDG goal number (1-17)
    - indicator_names: Optional list of specific indicators
    - analysis_type: Type of time series analysis
    - top_n: Number of entities to return
    - state_name: Optional state filter
    """
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        
        # Build base conditions
        conditions = ["sgd.nfhs_value_4 IS NOT NULL", "sgd.nfhs_value_5 IS NOT NULL"]
        params = []
        
        if sdg_goal_number:
            conditions.append("sg.major_sdg_goal = %s")
            params.append(sdg_goal_number)
        
        if indicator_names:
            indicator_placeholders = ','.join(['%s'] * len(indicator_names))
            conditions.append(f"sg.sdg_short_indicator_name IN ({indicator_placeholders})")
            params.extend(indicator_names)
        
        if state_name:
            conditions.append("ds.state_name ILIKE %s")
            params.append(f"%{state_name}%")
        
        base_condition = " AND ".join(conditions)
        
        if analysis_type in ["district_trends", "top_improvers", "top_decliners"]:
            # District-level analysis
            query = f"""
            SELECT 
                sgd.district_name,
                ds.state_name,
                sg.sdg_short_indicator_name,
                sg.sdg_full_indicator_name,
                sg.major_sdg_goal,
                sgd.nfhs_value_4,
                sgd.nfhs_value_5,
                sgd.actual_annual_change,
                COALESCE(sg.higher_is_better, FALSE) as higher_is_better,
                sgd.aspirational_status,
                sgd.district_sdg_status,
                -- Calculate absolute and percentage change
                (sgd.nfhs_value_5 - sgd.nfhs_value_4) as absolute_change,
                CASE 
                    WHEN sgd.nfhs_value_4 != 0 THEN 
                        ((sgd.nfhs_value_5 - sgd.nfhs_value_4) / ABS(sgd.nfhs_value_4)) * 100
                    ELSE NULL 
                END as percentage_change,
                -- Improvement classification
                CASE 
                    WHEN COALESCE(sg.higher_is_better, FALSE) = TRUE THEN
                        CASE 
                            WHEN sgd.nfhs_value_5 > sgd.nfhs_value_4 THEN 'Improved'
                            WHEN sgd.nfhs_value_5 < sgd.nfhs_value_4 THEN 'Declined'
                            ELSE 'Stable'
                        END
                    ELSE
                        CASE 
                            WHEN sgd.nfhs_value_5 < sgd.nfhs_value_4 THEN 'Improved'
                            WHEN sgd.nfhs_value_5 > sgd.nfhs_value_4 THEN 'Declined'
                            ELSE 'Stable'
                        END
                END as trend_direction
            FROM SDG_Goals_Data sgd
            JOIN SDG_Goals sg ON sgd.sdg_short_indicator_name = sg.sdg_short_indicator_name
            JOIN District_State ds ON sgd.district_name = ds.district_name
            WHERE {base_condition}
                         ORDER BY 
                 CASE 
                     WHEN 'top_improvers' = %s THEN ABS(sgd.actual_annual_change)
                     WHEN 'top_decliners' = %s THEN -ABS(sgd.actual_annual_change)
                     ELSE 0
                 END DESC, sgd.district_name
            LIMIT %s
            """
            params.extend([analysis_type, analysis_type, top_n])
            
        else:  # state_trends
            query = f"""
            WITH state_time_series AS (
                SELECT 
                    ds.state_name,
                    sg.sdg_short_indicator_name,
                    sg.sdg_full_indicator_name,
                    sg.major_sdg_goal,
                    COALESCE(sg.higher_is_better, FALSE) as higher_is_better,
                    COUNT(*) as district_count,
                    AVG(sgd.nfhs_value_4) as avg_2016,
                    AVG(sgd.nfhs_value_5) as avg_2021,
                    AVG(sgd.actual_annual_change) as avg_annual_change,
                    AVG(sgd.nfhs_value_5 - sgd.nfhs_value_4) as avg_absolute_change,
                    COUNT(CASE WHEN sgd.actual_annual_change > 0 AND sg.higher_is_better = TRUE THEN 1
                               WHEN sgd.actual_annual_change < 0 AND sg.higher_is_better = FALSE THEN 1 END) as improving_districts
                FROM SDG_Goals_Data sgd
                JOIN SDG_Goals sg ON sgd.sdg_short_indicator_name = sg.sdg_short_indicator_name
                JOIN District_State ds ON sgd.district_name = ds.district_name
                WHERE {base_condition}
                GROUP BY ds.state_name, sg.sdg_short_indicator_name, sg.sdg_full_indicator_name, 
                         sg.major_sdg_goal, sg.higher_is_better
            )
            SELECT 
                state_name,
                sdg_short_indicator_name,
                sdg_full_indicator_name,
                major_sdg_goal,
                higher_is_better,
                district_count,
                avg_2016,
                avg_2021,
                avg_annual_change,
                avg_absolute_change,
                improving_districts,
                CASE 
                    WHEN higher_is_better = TRUE THEN
                        CASE 
                            WHEN avg_2021 > avg_2016 THEN 'Improved'
                            WHEN avg_2021 < avg_2016 THEN 'Declined'
                            ELSE 'Stable'
                        END
                    ELSE
                        CASE 
                            WHEN avg_2021 < avg_2016 THEN 'Improved'
                            WHEN avg_2021 > avg_2016 THEN 'Declined'
                            ELSE 'Stable'
                        END
                END as overall_trend,
                (improving_districts::float / district_count * 100) as improvement_percentage
            FROM state_time_series
            ORDER BY ABS(avg_annual_change) DESC
            LIMIT %s
            """
            params.append(top_n)
        
        cursor.execute(query, params)
        results = cursor.fetchall()
        
        if not results:
            return {
                "error": "No time series data found for the specified criteria",
                "sdg_goal": sdg_goal_number,
                "indicators": indicator_names
            }
        
        # Format results based on analysis type
        if analysis_type in ["district_trends", "top_improvers", "top_decliners"]:
            formatted_results = []
            for row in results:
                result_data = {
                    "district": row[0],
                    "state": row[1],
                    "indicator_name": row[2],
                    "indicator_full_name": row[3],
                    "sdg_goal": row[4],
                    "nfhs_4_value": float(row[5]) if row[5] is not None else None,
                    "nfhs_5_value": float(row[6]) if row[6] is not None else None,
                    "annual_change": float(row[7]) if row[7] is not None else None,
                    "higher_is_better": row[8],
                    "aspirational_status": row[9],
                    "district_sdg_status": row[10],
                    "absolute_change": float(row[11]) if row[11] is not None else None,
                    "percentage_change": float(row[12]) if row[12] is not None else None,
                    "trend_direction": row[13],
                    "change_interpretation": interpret_time_series_change(
                        row[5], row[6], row[7], row[8], row[13]
                    )
                }
                formatted_results.append(result_data)
        
        else:  # state_trends
            formatted_results = []
            for row in results:
                result_data = {
                    "state": row[0],
                    "indicator_name": row[1],
                    "indicator_full_name": row[2],
                    "sdg_goal": row[3],
                    "higher_is_better": row[4],
                    "district_count": int(row[5]),
                    "avg_2016": float(row[6]) if row[6] is not None else None,
                    "avg_2021": float(row[7]) if row[7] is not None else None,
                    "avg_annual_change": float(row[8]) if row[8] is not None else None,
                    "avg_absolute_change": float(row[9]) if row[9] is not None else None,
                    "improving_districts": int(row[10]),
                    "overall_trend": row[11],
                    "improvement_percentage": float(row[12]) if row[12] is not None else None
                }
                formatted_results.append(result_data)
        
        # Calculate summary statistics
        if analysis_type in ["district_trends", "top_improvers", "top_decliners"]:
            improving_count = len([r for r in formatted_results if r["trend_direction"] == "Improved"])
            declining_count = len([r for r in formatted_results if r["trend_direction"] == "Declined"])
            stable_count = len([r for r in formatted_results if r["trend_direction"] == "Stable"])
        else:
            improving_count = len([r for r in formatted_results if r["overall_trend"] == "Improved"])
            declining_count = len([r for r in formatted_results if r["overall_trend"] == "Declined"])
            stable_count = len([r for r in formatted_results if r["overall_trend"] == "Stable"])
        
        # Get boundary data for all districts in the results
        all_districts = []
        if analysis_type in ["district_trends", "top_improvers", "top_decliners"]:
            all_districts = [result["district"] for result in formatted_results if "district" in result]
        
        boundary_data = get_district_boundary_data(all_districts) if all_districts else []
        
        cursor.close()
        conn.close()
        
        return {
            "success": True,
            "analysis_type": "time_series_comparison",
            "query_type": analysis_type,
            "sdg_goal": sdg_goal_number,
            "indicators": indicator_names,
            "state_filter": state_name,
            "time_period": "2016-2021 (NFHS-4 to NFHS-5)",
            "total_entities": len(formatted_results),
            "data": formatted_results,
            "boundary_data": boundary_data,
            "summary": {
                "improving": improving_count,
                "declining": declining_count,
                "stable": stable_count,
                "improvement_rate": round((improving_count / len(formatted_results)) * 100, 1) if formatted_results else 0
            },
            "map_type": "time_series_analysis"
        }
        
    except Exception as e:
        return {"error": f"Error in time series comparison: {str(e)}"}

def interpret_time_series_change(nfhs_4, nfhs_5, annual_change, higher_is_better, trend_direction):
    """Interpret time series changes with contextual information."""
    try:
        if nfhs_4 is None or nfhs_5 is None:
            return {"description": "Insufficient data for trend analysis"}
        
        absolute_change = nfhs_5 - nfhs_4
        percentage_change = ((nfhs_5 - nfhs_4) / abs(nfhs_4)) * 100 if nfhs_4 != 0 else 0
        
        # Determine magnitude
        if abs(percentage_change) > 20:
            magnitude = "significant"
        elif abs(percentage_change) > 10:
            magnitude = "moderate"
        elif abs(percentage_change) > 5:
            magnitude = "modest"
        else:
            magnitude = "minimal"
        
        # Create description
        direction_word = "improvement" if trend_direction == "Improved" else "decline" if trend_direction == "Declined" else "stability"
        
        description = f"{magnitude.title()} {direction_word}: "
        description += f"{nfhs_4:.2f} (2016) → {nfhs_5:.2f} (2021), "
        description += f"{percentage_change:+.1f}% change"
        
        if annual_change is not None:
            description += f", {annual_change:+.3f} annual change"
        
        return {
            "description": description,
            "magnitude": magnitude,
            "direction": trend_direction,
            "percentage_change": percentage_change,
            "is_significant": abs(percentage_change) > 10,
            "annual_rate": annual_change
        }
        
    except Exception as e:
        return {"description": f"Error interpreting change: {str(e)}"}

def get_aspirational_district_tracking(
    sdg_goal_number: Optional[int] = None,
    indicator_names: Optional[List[str]] = None,
    analysis_type: str = "performance_summary",  # "performance_summary", "top_performers", "most_improved", "needs_attention"
    year: int = 2021,
    top_n: int = 15,
    state_name: Optional[str] = None
):
    """
    Track and analyze performance of aspirational districts specifically.
    
    Parameters:
    - sdg_goal_number: Optional SDG goal number (1-17)
    - indicator_names: Optional list of specific indicators
    - analysis_type: Type of aspirational district analysis
    - year: 2016 or 2021
    - top_n: Number of districts to return
    - state_name: Optional state filter
    """
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        
        # Build base conditions - focus on aspirational districts
        conditions = ["sgd.aspirational_status = 'Aspirational Districts'"]
        params = []
        
        if sdg_goal_number:
            conditions.append("sg.major_sdg_goal = %s")
            params.append(sdg_goal_number)
        
        if indicator_names:
            indicator_placeholders = ','.join(['%s'] * len(indicator_names))
            conditions.append(f"sg.sdg_short_indicator_name IN ({indicator_placeholders})")
            params.extend(indicator_names)
        
        if state_name:
            conditions.append("ds.state_name ILIKE %s")
            params.append(f"%{state_name}%")
        
        # Determine year column
        year_column = "sgd.nfhs_value_5" if year == 2021 else "sgd.nfhs_value_4"
        conditions.append(f"{year_column} IS NOT NULL")
        conditions.append("sgd.actual_annual_change IS NOT NULL")
        conditions.append("sgd.nfhs_value_4 IS NOT NULL")
        conditions.append("sgd.nfhs_value_5 IS NOT NULL")
        
        base_condition = " AND ".join(conditions)
        
        if analysis_type == "performance_summary":
            # Overall performance summary of aspirational districts
            query = f"""
                         WITH indicator_ranks AS (
                 SELECT 
                     sgd.district_name,
                     ds.state_name,
                     sg.sdg_short_indicator_name,
                     sgd.actual_annual_change,
                     sgd.district_sdg_status,
                     sgd.aspirational_status,
                     {year_column} as current_value,
                     sgd.nfhs_value_4,
                     sgd.nfhs_value_5 - sgd.nfhs_value_4 as absolute_improvement,
                     CASE 
                         WHEN COALESCE(sg.higher_is_better, FALSE) = TRUE THEN 
                             PERCENT_RANK() OVER (PARTITION BY sg.sdg_short_indicator_name ORDER BY {year_column} DESC) * 100
                         ELSE 
                             PERCENT_RANK() OVER (PARTITION BY sg.sdg_short_indicator_name ORDER BY {year_column} ASC) * 100
                     END as performance_percentile,
                     COALESCE(sg.higher_is_better, FALSE) as higher_is_better
                 FROM SDG_Goals_Data sgd
                 JOIN SDG_Goals sg ON sgd.sdg_short_indicator_name = sg.sdg_short_indicator_name
                 JOIN District_State ds ON sgd.district_name = ds.district_name
                 WHERE {base_condition}
             ),
             aspirational_performance AS (
                 SELECT 
                     district_name,
                     state_name,
                     COUNT(*) as indicators_analyzed,
                     AVG(performance_percentile) as avg_performance_percentile,
                                         AVG(actual_annual_change) as avg_annual_change,
                     COUNT(CASE WHEN actual_annual_change > 0 AND higher_is_better = TRUE THEN 1
                                WHEN actual_annual_change < 0 AND higher_is_better = FALSE THEN 1 END) as improving_indicators,
                     AVG(current_value) as avg_current_value,
                     AVG(nfhs_value_4) as avg_baseline_value,
                     AVG(absolute_improvement) as avg_absolute_improvement,
                     district_sdg_status,
                    -- Calculate improvement trajectory
                                         CASE 
                         WHEN AVG(actual_annual_change) > 0.5 THEN 'Rapid Improvement'
                         WHEN AVG(actual_annual_change) > 0.1 THEN 'Steady Improvement'
                         WHEN AVG(actual_annual_change) > -0.1 THEN 'Stable'
                         ELSE 'Needs Urgent Attention'
                     END as improvement_trajectory
                 FROM indicator_ranks
                 GROUP BY district_name, state_name, district_sdg_status
            )
            SELECT * FROM aspirational_performance
            ORDER BY avg_performance_percentile DESC
            LIMIT %s
            """
            params.append(top_n)
            
        elif analysis_type == "top_performers":
            # Best performing aspirational districts
            query = f"""
            SELECT 
                sgd.district_name,
                ds.state_name,
                sg.sdg_short_indicator_name,
                sg.sdg_full_indicator_name,
                {year_column} as current_value,
                sgd.nfhs_value_4,
                sgd.nfhs_value_5,
                sgd.actual_annual_change,
                sgd.district_sdg_status,
                COALESCE(sg.higher_is_better, FALSE) as higher_is_better,
                CASE 
                    WHEN COALESCE(sg.higher_is_better, FALSE) = TRUE THEN 
                        PERCENT_RANK() OVER (PARTITION BY sg.sdg_short_indicator_name ORDER BY {year_column} DESC) * 100
                    ELSE 
                        PERCENT_RANK() OVER (PARTITION BY sg.sdg_short_indicator_name ORDER BY {year_column} ASC) * 100
                END as performance_percentile,
                -- Compare with non-aspirational districts
                (SELECT AVG({year_column}) FROM SDG_Goals_Data sgd2 
                 WHERE sgd2.sdg_short_indicator_name = sgd.sdg_short_indicator_name 
                 AND sgd2.aspirational_status != 'Aspirational Districts') as non_aspirational_avg
            FROM SDG_Goals_Data sgd
            JOIN SDG_Goals sg ON sgd.sdg_short_indicator_name = sg.sdg_short_indicator_name
            JOIN District_State ds ON sgd.district_name = ds.district_name
            WHERE {base_condition}
            ORDER BY performance_percentile DESC
            LIMIT %s
            """
            params.append(top_n)
            
        elif analysis_type == "most_improved":
            # Aspirational districts with highest improvement rates
            query = f"""
            SELECT 
                sgd.district_name,
                ds.state_name,
                sg.sdg_short_indicator_name,
                sg.sdg_full_indicator_name,
                sgd.nfhs_value_4,
                sgd.nfhs_value_5,
                sgd.actual_annual_change,
                (sgd.nfhs_value_5 - sgd.nfhs_value_4) as absolute_change,
                CASE 
                    WHEN sgd.nfhs_value_4 != 0 THEN 
                        ((sgd.nfhs_value_5 - sgd.nfhs_value_4) / ABS(sgd.nfhs_value_4)) * 100
                    ELSE NULL 
                END as percentage_change,
                sgd.district_sdg_status,
                COALESCE(sg.higher_is_better, FALSE) as higher_is_better,
                -- Improvement classification
                CASE 
                    WHEN COALESCE(sg.higher_is_better, FALSE) = TRUE THEN
                        CASE 
                            WHEN sgd.nfhs_value_5 > sgd.nfhs_value_4 THEN 'Improved'
                            WHEN sgd.nfhs_value_5 < sgd.nfhs_value_4 THEN 'Declined'
                            ELSE 'Stable'
                        END
                    ELSE
                        CASE 
                            WHEN sgd.nfhs_value_5 < sgd.nfhs_value_4 THEN 'Improved'
                            WHEN sgd.nfhs_value_5 > sgd.nfhs_value_4 THEN 'Declined'
                            ELSE 'Stable'
                        END
                END as improvement_status
            FROM SDG_Goals_Data sgd
            JOIN SDG_Goals sg ON sgd.sdg_short_indicator_name = sg.sdg_short_indicator_name
            JOIN District_State ds ON sgd.district_name = ds.district_name
            WHERE {base_condition}
            AND ((sg.higher_is_better = TRUE AND sgd.actual_annual_change > 0) OR 
                 (sg.higher_is_better = FALSE AND sgd.actual_annual_change < 0))
            ORDER BY ABS(sgd.actual_annual_change) DESC
            LIMIT %s
            """
            params.append(top_n)
            
        else:  # needs_attention
            # Aspirational districts that need urgent attention
            query = f"""
            SELECT 
                sgd.district_name,
                ds.state_name,
                sg.sdg_short_indicator_name,
                sg.sdg_full_indicator_name,
                {year_column} as current_value,
                sgd.nfhs_value_4,
                sgd.nfhs_value_5,
                sgd.actual_annual_change,
                sgd.district_sdg_status,
                COALESCE(sg.higher_is_better, FALSE) as higher_is_better,
                CASE 
                    WHEN COALESCE(sg.higher_is_better, FALSE) = TRUE THEN 
                        PERCENT_RANK() OVER (PARTITION BY sg.sdg_short_indicator_name ORDER BY {year_column} DESC) * 100
                    ELSE 
                        PERCENT_RANK() OVER (PARTITION BY sg.sdg_short_indicator_name ORDER BY {year_column} ASC) * 100
                END as performance_percentile,
                -- Priority score based on poor performance and negative trends
                CASE 
                    WHEN sgd.actual_annual_change < -0.5 THEN 'Critical'
                    WHEN sgd.actual_annual_change < -0.1 THEN 'High Priority'
                    WHEN sgd.actual_annual_change < 0.1 THEN 'Medium Priority'
                    ELSE 'Monitor'
                END as priority_level
            FROM SDG_Goals_Data sgd
            JOIN SDG_Goals sg ON sgd.sdg_short_indicator_name = sg.sdg_short_indicator_name
            JOIN District_State ds ON sgd.district_name = ds.district_name
            WHERE {base_condition}
            AND ((sg.higher_is_better = TRUE AND sgd.actual_annual_change <= 0) OR 
                 (sg.higher_is_better = FALSE AND sgd.actual_annual_change >= 0))
            ORDER BY 
                CASE 
                    WHEN sgd.actual_annual_change < -0.5 THEN 1
                    WHEN sgd.actual_annual_change < -0.1 THEN 2
                    WHEN sgd.actual_annual_change < 0.1 THEN 3
                    ELSE 4
                END, ABS(sgd.actual_annual_change) DESC
            LIMIT %s
            """
            params.append(top_n)
        
        cursor.execute(query, params)
        results = cursor.fetchall()
        
        if not results:
            return {
                "error": "No aspirational district data found for the specified criteria",
                "sdg_goal": sdg_goal_number,
                "indicators": indicator_names
            }
        
        # Format results based on analysis type
        formatted_results = []
        
        if analysis_type == "performance_summary":
            for row in results:
                result_data = {
                    "district": row[0],
                    "state": row[1],
                    "indicators_analyzed": int(row[2]),
                    "avg_performance_percentile": float(row[3]) if row[3] is not None else None,
                    "avg_annual_change": float(row[4]) if row[4] is not None else None,
                    "improving_indicators": int(row[5]),
                    "avg_current_value": float(row[6]) if row[6] is not None else None,
                    "avg_baseline_value": float(row[7]) if row[7] is not None else None,
                    "avg_absolute_improvement": float(row[8]) if row[8] is not None else None,
                    "district_sdg_status": row[9],
                    "improvement_trajectory": row[10],
                    "improvement_rate": round((row[5] / row[2]) * 100, 1) if row[2] > 0 else 0
                }
                formatted_results.append(result_data)
                
        else:
            # For other analysis types, use a more detailed format
            for row in results:
                if analysis_type == "top_performers":
                    result_data = {
                        "district": row[0],
                        "state": row[1],
                        "indicator_name": row[2],
                        "indicator_full_name": row[3],
                        "current_value": float(row[4]) if row[4] is not None else None,
                        "nfhs_4_value": float(row[5]) if row[5] is not None else None,
                        "nfhs_5_value": float(row[6]) if row[6] is not None else None,
                        "annual_change": float(row[7]) if row[7] is not None else None,
                        "district_sdg_status": row[8],
                        "higher_is_better": row[9],
                        "performance_percentile": float(row[10]) if row[10] is not None else None,
                        "non_aspirational_avg": float(row[11]) if row[11] is not None else None,
                        "compared_to_others": "Better" if (row[4] and row[11] and 
                                                         ((row[9] and row[4] > row[11]) or 
                                                          (not row[9] and row[4] < row[11]))) else "Needs Improvement"
                    }
                elif analysis_type == "most_improved":
                    result_data = {
                        "district": row[0],
                        "state": row[1],
                        "indicator_name": row[2],
                        "indicator_full_name": row[3],
                        "nfhs_4_value": float(row[4]) if row[4] is not None else None,
                        "nfhs_5_value": float(row[5]) if row[5] is not None else None,
                        "annual_change": float(row[6]) if row[6] is not None else None,
                        "absolute_change": float(row[7]) if row[7] is not None else None,
                        "percentage_change": float(row[8]) if row[8] is not None else None,
                        "district_sdg_status": row[9],
                        "higher_is_better": row[10],
                        "improvement_status": row[11]
                    }
                else:  # needs_attention
                    result_data = {
                        "district": row[0],
                        "state": row[1],
                        "indicator_name": row[2],
                        "indicator_full_name": row[3],
                        "current_value": float(row[4]) if row[4] is not None else None,
                        "nfhs_4_value": float(row[5]) if row[5] is not None else None,
                        "nfhs_5_value": float(row[6]) if row[6] is not None else None,
                        "annual_change": float(row[7]) if row[7] is not None else None,
                        "district_sdg_status": row[8],
                        "higher_is_better": row[9],
                        "performance_percentile": float(row[10]) if row[10] is not None else None,
                        "priority_level": row[11]
                    }
                
                formatted_results.append(result_data)
        
        # Get comparative statistics with non-aspirational districts
        comparative_stats = get_aspirational_comparative_stats(cursor, sdg_goal_number, indicator_names, year)
        
        # Get boundary data for all districts in the results
        all_districts = [result["district"] for result in formatted_results if "district" in result]
        boundary_data = get_district_boundary_data(all_districts) if all_districts else []
        
        cursor.close()
        conn.close()
        
        return {
            "success": True,
            "analysis_type": "aspirational_district_tracking",
            "query_type": analysis_type,
            "sdg_goal": sdg_goal_number,
            "indicators": indicator_names,
            "year": year,
            "total_districts": len(formatted_results),
            "data": formatted_results,
            "boundary_data": boundary_data,
            "comparative_stats": comparative_stats,
            "summary": {"total_analyzed": len(formatted_results), "analysis_type": analysis_type},
            "map_type": "aspirational_district_analysis"
        }
        
    except Exception as e:
        return {"error": f"Error in aspirational district tracking: {str(e)}"}

def get_aspirational_comparative_stats(cursor, sdg_goal_number, indicator_names, year):
    """Get comparative statistics between aspirational and non-aspirational districts."""
    try:
        conditions = []
        params = []
        
        if sdg_goal_number:
            conditions.append("sg.major_sdg_goal = %s")
            params.append(sdg_goal_number)
        
        if indicator_names:
            indicator_placeholders = ','.join(['%s'] * len(indicator_names))
            conditions.append(f"sg.sdg_short_indicator_name IN ({indicator_placeholders})")
            params.extend(indicator_names)
        
        year_column = "sgd.nfhs_value_5" if year == 2021 else "sgd.nfhs_value_4"
        conditions.append(f"{year_column} IS NOT NULL")
        
        base_condition = " AND ".join(conditions) if conditions else "1=1"
        
        query = f"""
        SELECT 
            sgd.aspirational_status,
            COUNT(DISTINCT sgd.district_name) as district_count,
            COUNT(*) as total_indicators,
            AVG({year_column}) as avg_indicator_value,
            AVG(sgd.actual_annual_change) as avg_annual_change,
            COUNT(CASE WHEN sgd.actual_annual_change > 0 AND sg.higher_is_better = TRUE THEN 1
                       WHEN sgd.actual_annual_change < 0 AND sg.higher_is_better = FALSE THEN 1 END) as improving_count,
            STDDEV({year_column}) as std_dev
        FROM SDG_Goals_Data sgd
        JOIN SDG_Goals sg ON sgd.sdg_short_indicator_name = sg.sdg_short_indicator_name
        WHERE {base_condition}
        GROUP BY sgd.aspirational_status
        """
        
        cursor.execute(query, params)
        results = cursor.fetchall()
        
        stats = {}
        for row in results:
            status = row[0] or "Unknown"
            stats[status] = {
                "district_count": int(row[1]),
                "total_indicators": int(row[2]),
                "avg_indicator_value": float(row[3]) if row[3] is not None else None,
                "avg_annual_change": float(row[4]) if row[4] is not None else None,
                "improving_count": int(row[5]),
                "improvement_rate": round((row[5] / row[2]) * 100, 1) if row[2] > 0 else 0,
                "std_dev": float(row[6]) if row[6] is not None else None
            }
        
        return stats
        
    except Exception as e:
        print(f"Error getting aspirational comparative stats: {e}")
        return {}

def generate_aspirational_summary(results, analysis_type):
    """Generate summary insights for aspirational district analysis."""
    try:
        if not results:
            return {"message": "No data available for summary"}
        
        summary = {
            "total_analyzed": len(results),
            "analysis_focus": analysis_type
        }
        
        if analysis_type == "performance_summary":
            # Summary for overall performance
            avg_performance = sum(r.get("avg_performance_percentile", 0) for r in results) / len(results)
            high_performers = len([r for r in results if r.get("avg_performance_percentile", 0) > 50])
            rapid_improvement = len([r for r in results if r.get("improvement_trajectory") == "Rapid Improvement"])
            
            summary.update({
                "avg_performance_percentile": round(avg_performance, 1),
                "high_performers": high_performers,
                "high_performer_rate": round((high_performers / len(results)) * 100, 1),
                "rapid_improvement_count": rapid_improvement,
                "improvement_leaders": [r["district"] for r in results[:3] if r.get("improvement_trajectory") == "Rapid Improvement"]
            })
            
        elif analysis_type == "most_improved":
            # Summary for improvement analysis
            avg_improvement = sum(r.get("annual_change", 0) for r in results) / len(results)
            significant_improvers = len([r for r in results if abs(r.get("annual_change", 0)) > 1.0])
            
            summary.update({
                "avg_annual_change": round(avg_improvement, 3),
                "significant_improvers": significant_improvers,
                "top_improver": results[0]["district"] if results else None,
                "improvement_range": {
                    "highest": max(r.get("annual_change", 0) for r in results),
                    "lowest": min(r.get("annual_change", 0) for r in results)
                }
            })
            
        elif analysis_type == "needs_attention":
            # Summary for priority attention
            priority_counts = {}
            for r in results:
                level = r.get("priority_level", "Unknown")
                priority_counts[level] = priority_counts.get(level, 0) + 1
            
            summary.update({
                "priority_breakdown": priority_counts,
                "critical_districts": [r["district"] for r in results if r.get("priority_level") == "Critical"],
                "urgent_intervention_needed": len([r for r in results if r.get("priority_level") in ["Critical", "High Priority"]])
            })
        
        return summary
        
    except Exception as e:
        return {"error": f"Error generating summary: {str(e)}"}

def get_cross_sdg_analysis(
    sdg_goals: List[int],  # List of SDG goals to analyze (e.g., [1, 3, 4])
    analysis_type: str = "correlation",  # "correlation", "multi_goal_performance", "goal_synergies", "best_worst_performers"
    year: int = 2021,
    top_n: int = 10,
    state_name: Optional[str] = None
):
    """
    Analyze relationships and patterns across multiple SDG goals.
    
    Parameters:
    - sdg_goals: List of SDG goal numbers to analyze
    - analysis_type: Type of cross-SDG analysis
    - year: 2016 or 2021
    - top_n: Number of districts/results to return
    - state_name: Optional state filter
    """
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        
        if len(sdg_goals) < 2:
            return {"error": "Cross-SDG analysis requires at least 2 SDG goals"}
        
        # Build base conditions
        conditions = [f"sg.major_sdg_goal IN ({','.join(['%s'] * len(sdg_goals))})"]
        params = sdg_goals.copy()
        
        if state_name:
            conditions.append("ds.state_name ILIKE %s")
            params.append(f"%{state_name}%")
        
        # Determine year column
        year_column = "sgd.nfhs_value_5" if year == 2021 else "sgd.nfhs_value_4"
        conditions.append(f"{year_column} IS NOT NULL")
        conditions.append("sgd.actual_annual_change IS NOT NULL")
        
        base_condition = " AND ".join(conditions)
        
        if analysis_type == "correlation":
            # Analyze correlations between SDG goals
            correlation_result = get_sdg_correlation_analysis(cursor, sdg_goals, year_column, base_condition, params)
            
            # Get boundary data for districts in correlation analysis
            all_districts = [result["district"] for result in correlation_result.get("data", []) if "district" in result]
            boundary_data = get_district_boundary_data(all_districts) if all_districts else []
            
            cursor.close()
            conn.close()
            
            return {
                "success": True,
                "analysis_type": "cross_sdg_analysis",
                "query_type": analysis_type,
                "sdg_goals": sdg_goals,
                "year": year,
                "state_filter": state_name,
                "data": correlation_result.get("data", []),
                "boundary_data": boundary_data,
                "correlations": correlation_result.get("correlations", {}),
                "goal_averages": correlation_result.get("goal_averages", {}),
                "summary": {"correlation_analysis": True, "total_analyzed": len(correlation_result.get("data", []))},
                "map_type": "cross_sdg_analysis"
            }
            
        elif analysis_type == "multi_goal_performance":
            # Districts performing well/poorly across multiple goals
            query = f"""
                         WITH indicator_performance AS (
                 SELECT 
                     sgd.district_name,
                     ds.state_name,
                     sg.major_sdg_goal,
                     sg.sdg_short_indicator_name,
                     sgd.actual_annual_change,
                     sgd.aspirational_status,
                     sgd.district_sdg_status,
                     CASE 
                         WHEN COALESCE(sg.higher_is_better, FALSE) = TRUE THEN 
                             PERCENT_RANK() OVER (PARTITION BY sg.sdg_short_indicator_name ORDER BY {year_column} DESC) * 100
                         ELSE 
                             PERCENT_RANK() OVER (PARTITION BY sg.sdg_short_indicator_name ORDER BY {year_column} ASC) * 100
                     END as performance_percentile,
                     COALESCE(sg.higher_is_better, FALSE) as higher_is_better
                 FROM SDG_Goals_Data sgd
                 JOIN SDG_Goals sg ON sgd.sdg_short_indicator_name = sg.sdg_short_indicator_name
                 JOIN District_State ds ON sgd.district_name = ds.district_name
                 WHERE {base_condition}
             ),
             district_sdg_performance AS (
                 SELECT 
                     district_name,
                     state_name,
                     major_sdg_goal,
                     COUNT(*) as indicators_per_goal,
                     AVG(performance_percentile) as avg_performance_percentile,
                                         AVG(actual_annual_change) as avg_annual_change,
                     COUNT(CASE WHEN actual_annual_change > 0 AND higher_is_better = TRUE THEN 1
                                WHEN actual_annual_change < 0 AND higher_is_better = FALSE THEN 1 END) as improving_indicators,
                     aspirational_status,
                     district_sdg_status
                 FROM indicator_performance
                 GROUP BY district_name, state_name, major_sdg_goal, 
                          aspirational_status, district_sdg_status
            ),
            district_overall_performance AS (
                SELECT 
                    district_name,
                    state_name,
                    COUNT(DISTINCT major_sdg_goal) as sdg_goals_covered,
                    AVG(avg_performance_percentile) as overall_performance,
                    AVG(avg_annual_change) as overall_improvement_rate,
                    SUM(improving_indicators) as total_improving_indicators,
                    SUM(indicators_per_goal) as total_indicators,
                    aspirational_status,
                    district_sdg_status,
                    -- Performance classification
                    CASE 
                        WHEN AVG(avg_performance_percentile) >= 75 THEN 'Excellent'
                        WHEN AVG(avg_performance_percentile) >= 50 THEN 'Good'
                        WHEN AVG(avg_performance_percentile) >= 25 THEN 'Moderate'
                        ELSE 'Needs Improvement'
                    END as performance_category,
                    -- Consistency measure (standard deviation of performance across goals)
                    STDDEV(avg_performance_percentile) as performance_consistency
                FROM district_sdg_performance
                GROUP BY district_name, state_name, aspirational_status, district_sdg_status
                HAVING COUNT(DISTINCT major_sdg_goal) = %s  -- Only districts with data for all requested SDG goals
            )
            SELECT * FROM district_overall_performance
            ORDER BY overall_performance DESC, performance_consistency ASC
            LIMIT %s
            """
            params.extend([len(sdg_goals), top_n])
            
        elif analysis_type == "goal_synergies":
            # Identify synergies and trade-offs between goals
            synergies_result = get_sdg_synergies_analysis(cursor, sdg_goals, year_column, base_condition, params, top_n)
            
            # Get boundary data for districts in synergies analysis
            all_districts = [result["district"] for result in synergies_result.get("data", []) if "district" in result]
            boundary_data = get_district_boundary_data(all_districts) if all_districts else []
            
            cursor.close()
            conn.close()
            
            return {
                "success": True,
                "analysis_type": "cross_sdg_analysis", 
                "query_type": analysis_type,
                "sdg_goals": sdg_goals,
                "year": year,
                "state_filter": state_name,
                "total_results": len(synergies_result.get("data", [])),
                "data": synergies_result.get("data", []),
                "boundary_data": boundary_data,
                "summary": {"synergies_analysis": True, "total_analyzed": len(synergies_result.get("data", []))},
                "map_type": "cross_sdg_analysis"
            }
            
        elif analysis_type == "best_worst_performers":
            # Find best and worst performers for each goal combination
            query = f"""
                         WITH district_goal_performance AS (
                 SELECT 
                     sgd.district_name,
                     ds.state_name,
                     sg.major_sdg_goal,
                     sgd.aspirational_status,
                     CASE 
                         WHEN COALESCE(sg.higher_is_better, FALSE) = TRUE THEN 
                             PERCENT_RANK() OVER (PARTITION BY sg.sdg_short_indicator_name ORDER BY {year_column} DESC) * 100
                         ELSE 
                             PERCENT_RANK() OVER (PARTITION BY sg.sdg_short_indicator_name ORDER BY {year_column} ASC) * 100
                     END as performance_score
                 FROM SDG_Goals_Data sgd
                 JOIN SDG_Goals sg ON sgd.sdg_short_indicator_name = sg.sdg_short_indicator_name
                 JOIN District_State ds ON sgd.district_name = ds.district_name
                 WHERE {base_condition}
             ),
             goal_combinations AS (
                 SELECT 
                     district_name,
                     state_name,
                     ARRAY_AGG(DISTINCT major_sdg_goal ORDER BY major_sdg_goal) as goals_array,
                     AVG(performance_score) as combined_performance,
                                         COUNT(*) as total_indicators,
                     aspirational_status
                 FROM district_goal_performance
                 GROUP BY district_name, state_name, aspirational_status
                 HAVING COUNT(DISTINCT major_sdg_goal) = %s
            )
            (SELECT 'Best Performers' as category, * FROM goal_combinations ORDER BY combined_performance DESC LIMIT %s)
            UNION ALL
            (SELECT 'Worst Performers' as category, * FROM goal_combinations ORDER BY combined_performance ASC LIMIT %s)
            """
            params.extend([len(sdg_goals), top_n//2, top_n//2])
        
        else:
            return {"error": f"Unknown analysis type: {analysis_type}"}
        
        cursor.execute(query, params)
        results = cursor.fetchall()
        
        if not results:
            return {
                "error": "No cross-SDG data found for the specified criteria",
                "sdg_goals": sdg_goals
            }
        
        # Format results based on analysis type
        formatted_results = []
        
        if analysis_type == "multi_goal_performance":
            for row in results:
                result_data = {
                    "district": row[0],
                    "state": row[1],
                    "sdg_goals_covered": int(row[2]),
                    "overall_performance": float(row[3]) if row[3] is not None else None,
                    "overall_improvement_rate": float(row[4]) if row[4] is not None else None,
                    "total_improving_indicators": int(row[5]),
                    "total_indicators": int(row[6]),
                    "aspirational_status": row[7],
                    "district_sdg_status": row[8],
                    "performance_category": row[9],
                    "performance_consistency": float(row[10]) if row[10] is not None else None,
                    "improvement_percentage": round((row[5] / row[6]) * 100, 1) if row[6] > 0 else 0,
                    "consistency_rating": "High" if (row[10] and row[10] < 15) else "Medium" if (row[10] and row[10] < 25) else "Low"
                }
                formatted_results.append(result_data)
                
        elif analysis_type == "best_worst_performers":
            for row in results:
                result_data = {
                    "category": row[0],
                    "district": row[1],
                    "state": row[2],
                    "goals_covered": row[3],
                    "combined_performance": float(row[4]) if row[4] is not None else None,
                    "total_indicators": int(row[5]),
                    "aspirational_status": row[6]
                }
                formatted_results.append(result_data)
        
        # Get detailed goal-specific data for top districts
        try:
            detailed_analysis = get_cross_sdg_detailed_data(cursor, formatted_results[:5], sdg_goals, year_column)
        except Exception as e:
            detailed_analysis = {"error": f"Error getting detailed analysis: {str(e)}"}
        
        # Get boundary data for all districts in the results
        all_districts = [result["district"] for result in formatted_results if "district" in result]
        boundary_data = get_district_boundary_data(all_districts) if all_districts else []
        
        cursor.close()
        conn.close()
        
        return {
            "success": True,
            "analysis_type": "cross_sdg_analysis",
            "query_type": analysis_type,
            "sdg_goals": sdg_goals,
            "year": year,
            "state_filter": state_name,
            "total_results": len(formatted_results),
            "data": formatted_results,
            "boundary_data": boundary_data,
            "detailed_analysis": detailed_analysis,
            "summary": {"total_analyzed": len(formatted_results), "analysis_type": analysis_type, "sdg_goals_count": len(sdg_goals)},
            "map_type": "cross_sdg_analysis"
        }
        
    except Exception as e:
        return {"error": f"Error in cross-SDG analysis: {str(e)}"}

def get_sdg_correlation_analysis(cursor, sdg_goals, year_column, base_condition, params):
    """Analyze correlations between different SDG goals."""
    try:
        # Create separate parameter list to avoid modifying the original
        correlation_params = params.copy()
        
        # Build safe SQL with proper parameter binding
        goal_case_statements = []
        for goal in sdg_goals:
            goal_case_statements.append("AVG(CASE WHEN major_sdg_goal = %s THEN performance_score END) as sdg_goal_score_" + str(goal))
            correlation_params.append(goal)
        
        goal_columns_sql = ",".join(goal_case_statements)
        
        # Get district performance data for correlation analysis
        query = f"""
        WITH indicator_percentiles AS (
            SELECT 
                sgd.district_name,
                ds.state_name,
                sg.major_sdg_goal,
                sg.sdg_short_indicator_name,
                CASE 
                    WHEN COALESCE(sg.higher_is_better, FALSE) = TRUE THEN 
                        PERCENT_RANK() OVER (PARTITION BY sg.sdg_short_indicator_name ORDER BY {year_column} ASC) * 100
                    ELSE 
                        PERCENT_RANK() OVER (PARTITION BY sg.sdg_short_indicator_name ORDER BY {year_column} DESC) * 100
                END as performance_score
            FROM SDG_Goals_Data sgd
            JOIN SDG_Goals sg ON sgd.sdg_short_indicator_name = sg.sdg_short_indicator_name
            JOIN District_State ds ON sgd.district_name = ds.district_name
            WHERE {base_condition}
        ),
        district_goal_performance AS (
            SELECT 
                district_name,
                state_name,
                major_sdg_goal,
                AVG(performance_score) as performance_score
            FROM indicator_percentiles
            GROUP BY district_name, state_name, major_sdg_goal
        )
        SELECT 
            district_name,
            state_name,
            {goal_columns_sql}
        FROM district_goal_performance
        GROUP BY district_name, state_name
        HAVING COUNT(DISTINCT major_sdg_goal) >= %s
        """
        
        # Require at least 2 goals instead of all goals
        correlation_params.append(min(2, len(sdg_goals)))
        cursor.execute(query, correlation_params)
        results = cursor.fetchall()
        
        if len(results) < 3:
            return {
                "correlations": {},
                "data": [],
                "error": f"Insufficient data for correlation analysis. Found {len(results)} districts, need at least 3.",
                "note": "Insufficient data for meaningful correlation analysis"
            }
        
        # Calculate correlations between goals
        correlations = {}
        goal_data = {}
        
        # Extract goal-specific data (columns are now at positions 2 onwards)
        for i, goal in enumerate(sdg_goals):
            goal_data[goal] = [row[i+2] for row in results if row[i+2] is not None]
        
        # Validate we have enough data points for each goal
        for goal in sdg_goals:
            if len(goal_data[goal]) < 3:
                return {
                    "correlations": {},
                    "data": [],
                    "error": f"Insufficient data for SDG Goal {goal}. Found {len(goal_data[goal])} districts with data.",
                    "note": "Need at least 3 districts with data for each SDG goal"
                }
        
        # Calculate pairwise correlations
        for i, goal1 in enumerate(sdg_goals):
            for j, goal2 in enumerate(sdg_goals):
                if i < j and len(goal_data[goal1]) > 0 and len(goal_data[goal2]) > 0:
                    # Create aligned data arrays (only districts with data for both goals)
                    aligned_data1 = []
                    aligned_data2 = []
                    for k, row in enumerate(results):
                        val1 = row[i+2]
                        val2 = row[j+2]
                        if val1 is not None and val2 is not None:
                            aligned_data1.append(val1)
                            aligned_data2.append(val2)
                    
                    if len(aligned_data1) >= 3:
                        correlation = calculate_correlation(aligned_data1, aligned_data2)
                        correlations[f"SDG_{goal1}_vs_SDG_{goal2}"] = {
                            "correlation": correlation,
                            "strength": interpret_correlation(correlation),
                            "sample_size": len(aligned_data1)
                        }
        
        formatted_results = []
        for row in results:
            result_data = {
                "district": row[0],
                "state": row[1]
            }
            for i, goal in enumerate(sdg_goals):
                result_data[f"sdg_{goal}_score"] = float(row[i+2]) if row[i+2] is not None else None
            formatted_results.append(result_data)
        
        return {
            "correlations": correlations,
            "data": formatted_results,
            "goal_averages": {f"sdg_{goal}": sum(goal_data[goal])/len(goal_data[goal]) if goal_data[goal] else None 
                             for goal in sdg_goals}
        }
        
    except Exception as e:
        return {"error": f"Error in correlation analysis: {str(e)}"}

def calculate_correlation(x_data, y_data):
    """Calculate Pearson correlation coefficient."""
    try:
        if len(x_data) != len(y_data) or len(x_data) < 2:
            return 0
        
        n = len(x_data)
        sum_x = sum(x_data)
        sum_y = sum(y_data)
        sum_xy = sum(x_data[i] * y_data[i] for i in range(n))
        sum_x2 = sum(x * x for x in x_data)
        sum_y2 = sum(y * y for y in y_data)
        
        numerator = n * sum_xy - sum_x * sum_y
        denominator = ((n * sum_x2 - sum_x * sum_x) * (n * sum_y2 - sum_y * sum_y)) ** 0.5
        
        return numerator / denominator if denominator != 0 else 0
        
    except Exception:
        return 0

def interpret_correlation(correlation):
    """Interpret correlation strength."""
    abs_corr = abs(correlation)
    if abs_corr >= 0.7:
        return "Strong"
    elif abs_corr >= 0.5:
        return "Moderate"
    elif abs_corr >= 0.3:
        return "Weak"
    else:
        return "Very Weak"

def get_sdg_synergies_analysis(cursor, sdg_goals, year_column, base_condition, params, top_n):
    """Analyze synergies and trade-offs between SDG goals."""
    try:
        # Create separate parameter list to avoid modifying the original
        synergies_params = params.copy()
        
        # Find districts that excel in some goals but lag in others
        query = f"""
        WITH indicator_percentiles AS (
            SELECT 
                sgd.district_name,
                ds.state_name,
                sg.major_sdg_goal,
                sg.sdg_short_indicator_name,
                CASE 
                    WHEN COALESCE(sg.higher_is_better, FALSE) = TRUE THEN 
                        PERCENT_RANK() OVER (PARTITION BY sg.sdg_short_indicator_name ORDER BY {year_column} ASC) * 100
                    ELSE 
                        PERCENT_RANK() OVER (PARTITION BY sg.sdg_short_indicator_name ORDER BY {year_column} DESC) * 100
                END as performance_score,
                sgd.actual_annual_change
            FROM SDG_Goals_Data sgd
            JOIN SDG_Goals sg ON sgd.sdg_short_indicator_name = sg.sdg_short_indicator_name
            JOIN District_State ds ON sgd.district_name = ds.district_name
            WHERE {base_condition}
        ),
        goal_performance AS (
            SELECT 
                district_name,
                state_name,
                major_sdg_goal,
                AVG(performance_score) as performance_score,
                AVG(actual_annual_change) as avg_change
            FROM indicator_percentiles
            GROUP BY district_name, state_name, major_sdg_goal
        ),
        district_synergies AS (
            SELECT 
                district_name,
                state_name,
                MAX(performance_score) as best_goal_performance,
                MIN(performance_score) as worst_goal_performance,
                (MAX(performance_score) - MIN(performance_score)) as performance_gap,
                AVG(performance_score) as avg_performance,
                COALESCE(STDDEV(performance_score), 0) as performance_variance,
                COUNT(*) as goals_covered,
                -- Identify synergy patterns (null-safe)
                CASE 
                    WHEN COALESCE(STDDEV(performance_score), 0) < 15 THEN 'Balanced Performance'
                    WHEN MAX(performance_score) > 75 AND MIN(performance_score) < 25 THEN 'High Variance'
                    WHEN MAX(performance_score) > 60 AND MIN(performance_score) > 40 THEN 'Consistent Good'
                    WHEN MAX(performance_score) < 40 THEN 'Consistent Poor'
                    ELSE 'Mixed Performance'
                END as synergy_pattern
            FROM goal_performance
            GROUP BY district_name, state_name
            HAVING COUNT(*) >= %s
        )
        SELECT * FROM district_synergies
        ORDER BY 
            CASE 
                WHEN synergy_pattern = 'Balanced Performance' THEN 1
                WHEN synergy_pattern = 'Consistent Good' THEN 2
                WHEN synergy_pattern = 'High Variance' THEN 3
                WHEN synergy_pattern = 'Mixed Performance' THEN 4
                ELSE 5
            END,
            avg_performance DESC
        LIMIT %s
        """
        
        # Require at least 2 goals instead of all goals
        synergies_params.extend([min(2, len(sdg_goals)), top_n])
        cursor.execute(query, synergies_params)
        results = cursor.fetchall()
        
        if len(results) < 1:
            return {
                "data": [],
                "error": f"No districts found with data for at least 2 of the requested SDG goals: {sdg_goals}",
                "note": "Try with different SDG goals or check data availability"
            }
        
        formatted_results = []
        for row in results:
            result_data = {
                "district": row[0],
                "state": row[1],
                "best_goal_performance": float(row[2]) if row[2] is not None else None,
                "worst_goal_performance": float(row[3]) if row[3] is not None else None,
                "performance_gap": float(row[4]) if row[4] is not None else None,
                "avg_performance": float(row[5]) if row[5] is not None else None,
                "performance_variance": float(row[6]) if row[6] is not None else 0.0,
                "goals_covered": int(row[7]),
                "synergy_pattern": row[8]
            }
            formatted_results.append(result_data)
        
        return {"data": formatted_results}
        
    except Exception as e:
        return {"error": f"Error in synergies analysis: {str(e)}"}

def get_cross_sdg_detailed_data(cursor, top_districts, sdg_goals, year_column):
    """Get detailed SDG data for top performing districts in cross-analysis."""
    try:
        if not top_districts:
            return {}
        
        district_names = [d.get("district") for d in top_districts if d.get("district")]
        if not district_names:
            return {}
        
        district_placeholders = ','.join(['%s'] * len(district_names))
        goal_placeholders = ','.join(['%s'] * len(sdg_goals))
        
        query = f"""
        SELECT 
            sgd.district_name,
            sg.major_sdg_goal,
            sg.sdg_short_indicator_name,
            sg.sdg_full_indicator_name,
            {year_column} as current_value,
            sgd.actual_annual_change,
            COALESCE(sg.higher_is_better, FALSE) as higher_is_better
        FROM SDG_Goals_Data sgd
        JOIN SDG_Goals sg ON sgd.sdg_short_indicator_name = sg.sdg_short_indicator_name
        WHERE sgd.district_name IN ({district_placeholders})
        AND sg.major_sdg_goal IN ({goal_placeholders})
        AND {year_column} IS NOT NULL
        ORDER BY sgd.district_name, sg.major_sdg_goal, sg.sdg_short_indicator_name
        """
        
        params = district_names + sdg_goals
        cursor.execute(query, params)
        results = cursor.fetchall()
        
        detailed_data = {}
        for row in results:
            district = row[0]
            if district not in detailed_data:
                detailed_data[district] = {}
            
            goal = row[1]
            if goal not in detailed_data[district]:
                detailed_data[district][goal] = []
            
            detailed_data[district][goal].append({
                "indicator_name": row[2],
                "indicator_full_name": row[3],
                "current_value": float(row[4]) if row[4] is not None else None,
                "annual_change": float(row[5]) if row[5] is not None else None,
                "higher_is_better": row[6]
            })
        
        return detailed_data
        
    except Exception as e:
        print(f"Error getting cross-SDG detailed data: {e}")
        return {}

def validate_percentile_calculation(cursor, sdg_goal_number, indicator_names, year):
    """
    Validate percentile calculations to detect potential data anomalies.
    This helps prevent misleading results due to data issues.
    """
    try:
        year_column = "sgd.nfhs_value_5" if year == 2021 else "sgd.nfhs_value_4"
        
        validation_results = {}
        
        for indicator in indicator_names:
            # Get basic statistics for this indicator
            cursor.execute(f"""
                SELECT 
                    sg.sdg_short_indicator_name,
                    sg.higher_is_better,
                    COUNT(*) as total_districts,
                    MIN({year_column}) as min_value,
                    MAX({year_column}) as max_value,
                    AVG({year_column}) as avg_value,
                    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY {year_column}) as median_value
                FROM SDG_Goals_Data sgd
                JOIN SDG_Goals sg ON sgd.sdg_short_indicator_name = sg.sdg_short_indicator_name
                WHERE sg.major_sdg_goal = %s
                AND sg.sdg_short_indicator_name = %s
                AND {year_column} IS NOT NULL
                GROUP BY sg.sdg_short_indicator_name, sg.higher_is_better
            """, (sdg_goal_number, indicator))
            
            result = cursor.fetchone()
            if result:
                indicator_name, higher_is_better, total, min_val, max_val, avg_val, median_val = result
                
                # Check for potential anomalies
                anomalies = []
                
                # Check if range is too narrow (might indicate data quality issues)
                if max_val - min_val < 0.01:
                    anomalies.append("Very narrow value range - possible data quality issue")
                
                # Check for extreme outliers
                if max_val > avg_val * 10:
                    anomalies.append("Potential extreme outliers detected")
                
                validation_results[indicator] = {
                    "higher_is_better": higher_is_better,
                    "total_districts": total,
                    "min_value": float(min_val),
                    "max_value": float(max_val),
                    "avg_value": float(avg_val),
                    "median_value": float(median_val),
                    "anomalies": anomalies
                }
        
        return validation_results
        
    except Exception as e:
        print(f"Error in percentile validation: {e}")
        return {}

def get_neighboring_districts_comparison(
    district_name: str,
    sdg_goal_number: Optional[int] = None,
    indicator_names: Optional[List[str]] = None,
    year: int = 2021,
    neighbor_method: str = "distance",  # "distance", "touching", "closest"
    max_distance_km: float = 100.0,
    max_neighbors: int = 10
):
    """
    Compare a district's SDG performance with its neighboring districts using spatial analysis.
    Enhanced with fallback logic and better error handling for urban areas.
    
    Parameters:
    - district_name: Target district to compare with neighbors
    - sdg_goal_number: Optional SDG goal number (1-17)
    - indicator_names: Optional list of specific indicator names
    - year: Year for analysis (2016 or 2021)
    - neighbor_method: Method to identify neighbors ("distance", "touching", "closest")
    - max_distance_km: Maximum distance for neighbors (only for distance method)
    - max_neighbors: Maximum number of neighbors to include
    
    Returns comprehensive comparison with target district and all neighbors
    """
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        
        # First, resolve the district name using fuzzy matching
        resolved_district = resolve_district_name(cursor, district_name)
        if not resolved_district:
            return {"error": f"District '{district_name}' not found"}
        
        target_district = resolved_district["district_name"]
        target_state = resolved_district["state_name"]
        
        # Check if target district has geometry data
        cursor.execute("""
            SELECT COUNT(*) FROM District_Geometry 
            WHERE UPPER(TRIM(district_name)) = %s
        """, (normalize_district_name(target_district),))
        has_geometry = cursor.fetchone()[0] > 0
        
        if not has_geometry:
            return {
                "error": f"No spatial data available for {target_district}",
                "suggestion": f"Try analyzing {target_district} individually or compare with state-level data",
                "target_district": target_district,
                "target_state": target_state
            }
        
        # Find neighboring districts using spatial analysis with fallback logic
        neighbors = []
        methods_tried = []
        
        # Try the requested method first
        neighbors = find_neighboring_districts(
            cursor, target_district, neighbor_method, max_distance_km, max_neighbors
        )
        methods_tried.append(neighbor_method)
        
        # If no neighbors found, try fallback methods
        if not neighbors:
            fallback_methods = []
            
            if neighbor_method == "touching":
                # For touching method, try distance-based as fallback
                fallback_methods = [("distance", 50.0), ("distance", 100.0), ("closest", max_distance_km)]
            elif neighbor_method == "distance":
                # For distance method, try with larger radius and then closest
                fallback_methods = [("distance", max_distance_km * 2), ("closest", max_distance_km), ("touching", max_distance_km)]
            else:  # closest
                # For closest method, try distance-based fallbacks
                fallback_methods = [("distance", 100.0), ("distance", 200.0), ("touching", max_distance_km)]
            
            for fallback_method, fallback_distance in fallback_methods:
                if fallback_method not in methods_tried:
                    neighbors = find_neighboring_districts(
                        cursor, target_district, fallback_method, fallback_distance, max_neighbors
                    )
                    methods_tried.append(fallback_method)
                    if neighbors:
                        neighbor_method = fallback_method  # Update the method used
                        if fallback_method == "distance":
                            max_distance_km = fallback_distance
                        break
        
        if not neighbors:
            return {
                "error": f"No neighboring districts found for {target_district} using any spatial method",
                "methods_tried": methods_tried,
                "suggestion": f"This may be an isolated district or lack complete spatial data. Try using radius-based analysis or state-level comparison instead.",
                "target_district": target_district,
                "target_state": target_state,
                "alternative_query": f"Try: 'Show districts within 200km of {target_district}' or 'Compare {target_district} with other districts in {target_state}'"
            }
        
        # Get all district names for performance comparison
        all_districts = [target_district] + [n["district_name"] for n in neighbors]
        
        # Get performance data for all districts
        if sdg_goal_number and indicator_names:
            # Specific indicators requested
            performance_data = get_districts_indicator_data(
                cursor, all_districts, sdg_goal_number, indicator_names, year
            )
        elif sdg_goal_number:
            # Get all available indicators for this SDG goal
            available_indicators = get_indicators_by_sdg_goal(sdg_goal_number)
            if available_indicators and available_indicators.get("indicators"):
                # Use all available indicators for detailed comparison
                all_indicator_names = [ind["short_name"] for ind in available_indicators["indicators"]]
                performance_data = get_districts_indicator_data(
                    cursor, all_districts, sdg_goal_number, all_indicator_names, year
                )
            else:
                # Fallback to overall SDG goal performance
                performance_data = get_districts_overall_sdg_data(
                    cursor, all_districts, sdg_goal_number, year
                )
        else:
            # Multi-goal overview
            performance_data = get_districts_multi_goal_data(
                cursor, all_districts, year
            )
        
        # Separate target district from neighbors
        target_performance = None
        neighbor_performance = []
        
        for district_data in performance_data:
            if district_data["district_name"] == target_district:
                target_performance = district_data
            else:
                neighbor_performance.append(district_data)
        
        # Add spatial relationship info to neighbor performance
        for neighbor_perf in neighbor_performance:
            for neighbor_info in neighbors:
                if neighbor_perf["district_name"] == neighbor_info["district_name"]:
                    neighbor_perf.update(neighbor_info)
                    break
        
        # Generate comparative analysis
        comparison_analysis = generate_neighbor_comparison_analysis(
            target_performance, neighbor_performance, sdg_goal_number, indicator_names
        )
        
        # Get boundary data for visualization
        boundary_data = get_district_boundary_data(all_districts)
        
        # Ensure consistent data structure for both target and neighbors
        neighbors_formatted = []
        for neighbor_perf in neighbor_performance:
            # Extract spatial info
            spatial_info = {
                "distance_km": neighbor_perf.get("distance_km"),
                "relationship": neighbor_perf.get("relationship")
            }
            
            # Create clean performance data (without spatial fields)
            performance_data = {
                "district_name": neighbor_perf["district_name"],
                "state_name": neighbor_perf["state_name"],
                "indicators": neighbor_perf.get("indicators", []),
                "overall_performance": neighbor_perf.get("overall_performance", 0)
            }
            
            # Create consistent neighbor structure
            neighbor_formatted = {
                "district_name": neighbor_perf["district_name"],
                "state_name": neighbor_perf["state_name"],
                "performance": performance_data
            }
            
            # Add spatial info to top level
            neighbor_formatted.update(spatial_info)
            neighbors_formatted.append(neighbor_formatted)

        result = {
            "target_district": {
                "district_name": target_district,
                "state_name": target_state,
                "performance": target_performance
            },
            "neighbors": neighbors_formatted,
            "neighbor_method": neighbor_method,
            "neighbor_method_used": neighbor_method,  # The actual method that found neighbors
            "methods_tried": methods_tried,
            "neighbor_count": len(neighbors),
            "analysis": comparison_analysis,
            "boundary_data": boundary_data,
            "map_type": "neighbor_comparison",
            "year": year,
            "sdg_goal": sdg_goal_number,
            "indicators": indicator_names,
            "success": True,
            "message": f"Found {len(neighbors)} neighboring districts using '{neighbor_method}' method" + 
                      (f" (fallback from original method)" if len(methods_tried) > 1 else ""),
            "max_distance_km": max_distance_km if neighbor_method == "distance" else None
        }
        
        cursor.close()
        conn.close()
        
        return result
        
    except Exception as e:
        return {"error": f"Error in neighboring districts comparison: {str(e)}"}

def resolve_district_name(cursor, district_name):
    """Resolve district name using fuzzy matching and return district info."""
    try:
        # First try exact match
        cursor.execute("""
            SELECT DISTINCT district_name, state_name 
            FROM District_State 
            WHERE LOWER(district_name) = LOWER(%s)
        """, (district_name,))
        result = cursor.fetchone()
        
        if result:
            return {"district_name": result[0], "state_name": result[1]}
        
        # Try fuzzy matching
        cursor.execute("SELECT DISTINCT district_name, state_name FROM District_State")
        all_districts = cursor.fetchall()
        
        district_options = [f"{row[0]}, {row[1]}" for row in all_districts]
        best_match = process.extractOne(district_name, district_options, score_cutoff=70)
        
        if best_match:
            matched_district = best_match[0].split(", ")[0]
            matched_state = best_match[0].split(", ")[1]
            return {"district_name": matched_district, "state_name": matched_state}
        
        return None
        
    except Exception as e:
        print(f"Error resolving district name: {e}")
        return None

def find_neighboring_districts(cursor, target_district, method, max_distance_km, max_neighbors):
    """Find neighboring districts using specified spatial method."""
    try:
        neighbors = []
        
        if method == "touching":
            # Find districts that share a boundary
            cursor.execute("""
                SELECT d2.district_name, d2.state_name, 'Shared Boundary' as relationship
                FROM District_Geometry d1, District_Geometry d2
                WHERE UPPER(TRIM(d1.district_name)) = %s
                AND UPPER(TRIM(d1.district_name)) != UPPER(TRIM(d2.district_name))
                AND ST_Touches(d1.geom, d2.geom)
                LIMIT %s
            """, (normalize_district_name(target_district), max_neighbors))
            
        elif method == "distance":
            # Find districts within specified distance
            cursor.execute("""
                SELECT d2.district_name, d2.state_name,
                       CAST(ST_Distance(ST_Transform(d1.geom, 3857), ST_Transform(d2.geom, 3857))/1000.0 AS NUMERIC(10,2)) as distance_km
                FROM District_Geometry d1, District_Geometry d2
                WHERE UPPER(TRIM(d1.district_name)) = %s
                AND UPPER(TRIM(d1.district_name)) != UPPER(TRIM(d2.district_name))
                AND ST_DWithin(ST_Transform(d1.geom, 3857), ST_Transform(d2.geom, 3857), %s)
                ORDER BY ST_Distance(d1.geom, d2.geom)
                LIMIT %s
            """, (normalize_district_name(target_district), max_distance_km * 1000, max_neighbors))
            
        else:  # closest
            # Find closest districts by centroid distance
            cursor.execute("""
                SELECT d2.district_name, d2.state_name,
                       CAST(ST_Distance(ST_Transform(d1.centroid, 3857), ST_Transform(d2.centroid, 3857))/1000.0 AS NUMERIC(10,2)) as distance_km
                FROM District_Geometry d1, District_Geometry d2
                WHERE UPPER(TRIM(d1.district_name)) = %s
                AND UPPER(TRIM(d1.district_name)) != UPPER(TRIM(d2.district_name))
                AND d2.geom IS NOT NULL
                ORDER BY ST_Distance(d1.centroid, d2.centroid)
                LIMIT %s
            """, (normalize_district_name(target_district), max_neighbors))
        
        results = cursor.fetchall()
        
        for row in results:
            neighbor_info = {
                "district_name": row[0],
                "state_name": row[1]
            }
            
            if len(row) > 2:
                if method == "touching":
                    neighbor_info["relationship"] = row[2]
                else:
                    neighbor_info["distance_km"] = float(row[2])
                    neighbor_info["relationship"] = f"Within {row[2]} km"
            
            neighbors.append(neighbor_info)
        
        return neighbors
        
    except Exception as e:
        print(f"Error finding neighboring districts: {e}")
        return []

def get_districts_indicator_data(cursor, district_names, sdg_goal_number, indicator_names, year):
    """Get specific indicator data for multiple districts."""
    try:
        year_column = "sgd.nfhs_value_5" if year == 2021 else "sgd.nfhs_value_4"
        other_year_column = "sgd.nfhs_value_4" if year == 2021 else "sgd.nfhs_value_5"
        
        district_placeholders = ','.join(['%s'] * len(district_names))
        indicator_placeholders = ','.join(['%s'] * len(indicator_names))
        
        query = f"""
        SELECT 
            sgd.district_name,
            ds.state_name,
            sg.sdg_short_indicator_name,
            sg.sdg_full_indicator_name,
            {year_column} as current_value,
            {other_year_column} as previous_value,
            sgd.actual_annual_change,
            COALESCE(sg.higher_is_better, FALSE) as higher_is_better,
            -- Calculate percentile ranking
            CASE 
                WHEN COALESCE(sg.higher_is_better, FALSE) = TRUE THEN 
                    PERCENT_RANK() OVER (PARTITION BY sg.sdg_short_indicator_name ORDER BY {year_column} DESC) * 100
                ELSE 
                    PERCENT_RANK() OVER (PARTITION BY sg.sdg_short_indicator_name ORDER BY {year_column} ASC) * 100
            END as performance_percentile
        FROM SDG_Goals_Data sgd
        JOIN SDG_Goals sg ON sgd.sdg_short_indicator_name = sg.sdg_short_indicator_name
        JOIN District_State ds ON sgd.district_name = ds.district_name
        WHERE sgd.district_name IN ({district_placeholders})
        AND sg.major_sdg_goal = %s
        AND sg.sdg_short_indicator_name IN ({indicator_placeholders})
        AND {year_column} IS NOT NULL
        ORDER BY sgd.district_name, sg.sdg_short_indicator_name
        """
        
        params = district_names + [sdg_goal_number] + indicator_names
        cursor.execute(query, params)
        results = cursor.fetchall()
        
        # Group by district
        districts_data = {}
        for row in results:
            district_name = row[0]
            if district_name not in districts_data:
                districts_data[district_name] = {
                    "district_name": district_name,
                    "state_name": row[1],
                    "indicators": [],
                    "overall_performance": 0
                }
            
            indicator_data = {
                "indicator_name": row[2],
                "indicator_full_name": row[3],
                "current_value": float(row[4]) if row[4] is not None else None,
                "previous_value": float(row[5]) if row[5] is not None else None,
                "annual_change": float(row[6]) if row[6] is not None else None,
                "higher_is_better": row[7],
                "performance_percentile": float(row[8]) if row[8] is not None else None
            }
            
            districts_data[district_name]["indicators"].append(indicator_data)
        
        # Calculate overall performance for each district
        for district_data in districts_data.values():
            if district_data["indicators"]:
                avg_percentile = np.mean([
                    ind["performance_percentile"] for ind in district_data["indicators"]
                    if ind["performance_percentile"] is not None
                ])
                district_data["overall_performance"] = float(avg_percentile)
        
        return list(districts_data.values())
        
    except Exception as e:
        print(f"Error getting districts indicator data: {e}")
        return []

def get_districts_overall_sdg_data(cursor, district_names, sdg_goal_number, year):
    """Get overall SDG goal performance for multiple districts."""
    try:
        year_column = "sgd.nfhs_value_5" if year == 2021 else "sgd.nfhs_value_4"
        
        district_placeholders = ','.join(['%s'] * len(district_names))
        
        query = f"""
        WITH district_rankings AS (
            SELECT 
                sgd.district_name,
                ds.state_name,
                sg.sdg_short_indicator_name,
                CASE 
                    WHEN COALESCE(sg.higher_is_better, FALSE) = TRUE THEN 
                        PERCENT_RANK() OVER (PARTITION BY sg.sdg_short_indicator_name ORDER BY {year_column} DESC) * 100
                    ELSE 
                        PERCENT_RANK() OVER (PARTITION BY sg.sdg_short_indicator_name ORDER BY {year_column} ASC) * 100
                END as performance_percentile,
                sgd.actual_annual_change
            FROM SDG_Goals_Data sgd
            JOIN SDG_Goals sg ON sgd.sdg_short_indicator_name = sg.sdg_short_indicator_name
            JOIN District_State ds ON sgd.district_name = ds.district_name
            WHERE sgd.district_name IN ({district_placeholders})
            AND sg.major_sdg_goal = %s
            AND {year_column} IS NOT NULL
        )
        SELECT 
            district_name,
            state_name,
            AVG(performance_percentile) as overall_performance,
            AVG(actual_annual_change) as avg_annual_change,
            COUNT(*) as indicator_count
        FROM district_rankings
        GROUP BY district_name, state_name
        ORDER BY overall_performance DESC
        """
        
        params = district_names + [sdg_goal_number]
        cursor.execute(query, params)
        results = cursor.fetchall()
        
        districts_data = []
        for row in results:
            districts_data.append({
                "district_name": row[0],
                "state_name": row[1],
                "overall_performance": float(row[2]) if row[2] is not None else None,
                "avg_annual_change": float(row[3]) if row[3] is not None else None,
                "indicator_count": int(row[4])
            })
        
        return districts_data
        
    except Exception as e:
        print(f"Error getting districts overall SDG data: {e}")
        return []

def get_districts_multi_goal_data(cursor, district_names, year):
    """Get multi-goal performance overview for districts."""
    try:
        year_column = "sgd.nfhs_value_5" if year == 2021 else "sgd.nfhs_value_4"
        
        district_placeholders = ','.join(['%s'] * len(district_names))
        
        query = f"""
        WITH district_goal_rankings AS (
            SELECT 
                sgd.district_name,
                ds.state_name,
                sg.major_sdg_goal,
                sg.sdg_short_indicator_name,
                CASE 
                    WHEN COALESCE(sg.higher_is_better, FALSE) = TRUE THEN 
                        PERCENT_RANK() OVER (PARTITION BY sg.sdg_short_indicator_name ORDER BY {year_column} DESC) * 100
                    ELSE 
                        PERCENT_RANK() OVER (PARTITION BY sg.sdg_short_indicator_name ORDER BY {year_column} ASC) * 100
                END as performance_percentile
            FROM SDG_Goals_Data sgd
            JOIN SDG_Goals sg ON sgd.sdg_short_indicator_name = sg.sdg_short_indicator_name
            JOIN District_State ds ON sgd.district_name = ds.district_name
            WHERE sgd.district_name IN ({district_placeholders})
            AND {year_column} IS NOT NULL
        )
        SELECT 
            district_name,
            state_name,
            major_sdg_goal,
            AVG(performance_percentile) as goal_performance,
            COUNT(*) as indicator_count
        FROM district_goal_rankings
        GROUP BY district_name, state_name, major_sdg_goal
        ORDER BY district_name, major_sdg_goal
        """
        
        cursor.execute(query, district_names)
        results = cursor.fetchall()
        
        # Group by district
        districts_data = {}
        for row in results:
            district_name = row[0]
            if district_name not in districts_data:
                districts_data[district_name] = {
                    "district_name": district_name,
                    "state_name": row[1],
                    "sdg_goals": [],
                    "overall_performance": 0
                }
            
            districts_data[district_name]["sdg_goals"].append({
                "sdg_goal": int(row[2]),
                "performance": float(row[3]) if row[3] is not None else None,
                "indicator_count": int(row[4])
            })
        
        # Calculate overall performance
        for district_data in districts_data.values():
            if district_data["sdg_goals"]:
                avg_performance = np.mean([
                    goal["performance"] for goal in district_data["sdg_goals"]
                    if goal["performance"] is not None
                ])
                district_data["overall_performance"] = float(avg_performance)
        
        return list(districts_data.values())
        
    except Exception as e:
        print(f"Error getting districts multi-goal data: {e}")
        return []

def generate_neighbor_comparison_analysis(target, neighbors, sdg_goal_number, indicator_names):
    """Generate comprehensive analysis comparing target district with neighbors."""
    try:
        if not target or not neighbors:
            return "Insufficient data for analysis"
        
        analysis_parts = []
        
        # Basic comparison
        target_name = target["district_name"]
        target_state = target["state_name"]
        
        analysis_parts.append(f"### **Neighboring Districts Analysis for {target_name}, {target_state}**\n")
        
        # Get indicators from correct data structure (nested under performance)
        target_indicators = []
        if target.get("performance", {}).get("indicators"):
            target_indicators = target["performance"]["indicators"]
        elif target.get("indicators"):
            target_indicators = target["indicators"]  # fallback for old structure
            
        if sdg_goal_number and target_indicators and len(target_indicators) > 0:
            # Specific indicator analysis with detailed comparisons
            analysis_parts.append(f"#### **SDG Goal {sdg_goal_number} - Indicator Comparisons**\n")
            
            for indicator in target_indicators:
                indicator_name = indicator["indicator_full_name"]
                target_value = indicator["current_value"]
                target_percentile = indicator["performance_percentile"]
                
                # Compare with neighbors for this indicator
                neighbor_values = []
                for neighbor in neighbors:
                    # Get neighbor indicators from correct data structure
                    neighbor_indicators = []
                    if neighbor.get("performance", {}).get("indicators"):
                        neighbor_indicators = neighbor["performance"]["indicators"]
                    elif neighbor.get("indicators"):
                        neighbor_indicators = neighbor["indicators"]  # fallback
                        
                    for neighbor_ind in neighbor_indicators:
                        if neighbor_ind["indicator_name"] == indicator["indicator_name"]:
                            neighbor_values.append({
                                "district": neighbor["district_name"],
                                "value": neighbor_ind["current_value"],
                                "percentile": neighbor_ind["performance_percentile"],
                                "distance": neighbor.get("distance_km", "N/A")
                            })
                
                if neighbor_values and target_percentile is not None:
                    better_neighbors = [n for n in neighbor_values if n["percentile"] and n["percentile"] > target_percentile]
                    worse_neighbors = [n for n in neighbor_values if n["percentile"] and n["percentile"] < target_percentile]
                    
                    analysis_parts.append(f"📊 **{indicator_name}**:")
                    analysis_parts.append(f"   • {target_name}: {target_value:.1f} (Percentile: {target_percentile:.1f})")
                    
                    if better_neighbors:
                        best_neighbor = max(better_neighbors, key=lambda x: x["percentile"])
                        analysis_parts.append(f"   • Best neighbor: {best_neighbor['district']} with {best_neighbor['value']:.1f} ({best_neighbor['percentile']:.1f} percentile)")
                    
                    if worse_neighbors:
                        worst_neighbor = min(worse_neighbors, key=lambda x: x["percentile"])
                        analysis_parts.append(f"   • Lowest neighbor: {worst_neighbor['district']} with {worst_neighbor['value']:.1f} ({worst_neighbor['percentile']:.1f} percentile)")
                    
                    analysis_parts.append(f"   • Performance ranking: {len(better_neighbors) + 1}/{len(neighbor_values) + 1} among neighbors\n")
        
        elif sdg_goal_number:
            # Overall SDG goal analysis
            analysis_parts.append(f"#### **SDG Goal {sdg_goal_number} - Overall Performance Analysis**\n")
            
            target_performance = target.get("overall_performance", 0)
            neighbor_performances = [n.get("overall_performance", 0) for n in neighbors if n.get("overall_performance") is not None]
            
            if target_performance and neighbor_performances:
                better_count = len([p for p in neighbor_performances if p > target_performance])
                worse_count = len([p for p in neighbor_performances if p < target_performance])
                
                analysis_parts.append(f"• **{target_name}'s overall performance**: {target_performance:.1f} percentile")
                analysis_parts.append(f"• **Among {len(neighbors)} neighbors**: {better_count} perform better, {worse_count} perform worse")
                
                if neighbor_performances:
                    best_neighbor_perf = max(neighbor_performances)
                    best_neighbor = next(n for n in neighbors if n.get("overall_performance") == best_neighbor_perf)
                    analysis_parts.append(f"• **Best neighbor**: {best_neighbor['district_name']} with {best_neighbor_perf:.1f} percentile")
                    
                    analysis_parts.append(f"• **Performance range among neighbors**: {min(neighbor_performances):.1f} to {max(neighbor_performances):.1f}")
        
        # Spatial context
        analysis_parts.append("#### **Spatial Context**")
        
        if neighbors:
            distances = [n.get("distance_km") for n in neighbors if n.get("distance_km") is not None]
            if distances:
                avg_distance = sum(distances) / len(distances)
                analysis_parts.append(f"• **Average distance to neighbors**: Approximately {avg_distance:.1f} km")
                analysis_parts.append(f"• **Distance range**: From {min(distances):.1f} km to {max(distances):.1f} km")
            
            # Geographic span
            states = list(set([n.get("state_name") for n in neighbors if n.get("state_name")]))
            if len(states) == 1:
                analysis_parts.append(f"• **Geographical span**: All neighbors are within the state of {states[0]}")
            else:
                analysis_parts.append(f"• **Geographical span**: Neighbors span across {len(states)} states: {', '.join(states)}")
        
        # Summary assessment
        if sdg_goal_number and target_indicators:
            indicator_count = len(target_indicators)
            analysis_parts.append(f"\n#### **Summary Assessment**")
            analysis_parts.append(f"{target_name}'s performance on SDG {sdg_goal_number} shows specific strengths and areas for improvement compared to its neighboring districts. ")
            
            # Check for overall performance in nested structure
            overall_performance = None
            if target.get("performance", {}).get("overall_performance") is not None:
                overall_performance = target["performance"]["overall_performance"]
            elif target.get("overall_performance") is not None:
                overall_performance = target["overall_performance"]
                
            if overall_performance is not None:
                if overall_performance < 50:
                    analysis_parts.append(f"With an overall performance in the lower percentiles, there is significant potential for improvement, particularly by learning from higher-performing neighboring districts.")
                else:
                    analysis_parts.append(f"The district demonstrates solid performance, ranking well among its neighbors in the region.")
        
        return "\n".join(analysis_parts)
        
    except Exception as e:
        print(f"Error generating neighbor comparison analysis: {e}")
        return f"Analysis could not be generated: {str(e)}"

def get_state_wise_indicator_extremes(
    indicator_name: str,
    year: int = 2021,
    include_aac: bool = True,
    min_districts_per_state: int = 3
):
    """
    Get the best and worst performing districts for a specific indicator in every state.
    
    Parameters:
    - indicator_name: Short name of the indicator (e.g., "Skilled Birth Attendants")
    - year: Year for analysis (2016 or 2021)
    - include_aac: Whether to include annual average change analysis
    - min_districts_per_state: Minimum number of districts required per state to include in results
    
    Returns state-wise best and worst performers with detailed analysis
    """
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        
        year_column = "sgd.nfhs_value_5" if year == 2021 else "sgd.nfhs_value_4"
        other_year_column = "sgd.nfhs_value_4" if year == 2021 else "sgd.nfhs_value_5"
        
        # Resolve indicator name using fuzzy matching
        resolved_indicator = fuzzy_match_indicator(indicator_name)
        if not resolved_indicator:
            return {"error": f"Indicator '{indicator_name}' not found. Please check the indicator name."}
        
        # Get indicator metadata using resolved name
        cursor.execute("""
            SELECT sdg_short_indicator_name, sdg_full_indicator_name, major_sdg_goal, higher_is_better
            FROM SDG_Goals 
            WHERE sdg_short_indicator_name = %s OR sdg_full_indicator_name = %s
        """, (resolved_indicator, resolved_indicator))
        
        indicator_info = cursor.fetchone()
        if not indicator_info:
            return {"error": f"Indicator '{indicator_name}' could not be resolved to database format"}
        
        # Use the short name for database queries
        resolved_short_name = indicator_info[0]
        full_indicator_name = indicator_info[1]
        sdg_goal = indicator_info[2]
        higher_is_better = indicator_info[3]
        
        # Get all districts with data for this indicator
        query = f"""
        SELECT 
            sgd.district_name,
            ds.state_name,
            {year_column} as current_value,
            {other_year_column} as previous_value,
            sgd.actual_annual_change,
            -- Calculate state-wise ranking
            ROW_NUMBER() OVER (
                PARTITION BY ds.state_name 
                ORDER BY {year_column} {'DESC' if higher_is_better else 'ASC'}
            ) as state_rank_best,
            ROW_NUMBER() OVER (
                PARTITION BY ds.state_name 
                ORDER BY {year_column} {'ASC' if higher_is_better else 'DESC'}
            ) as state_rank_worst,
            -- Count districts per state
            COUNT(*) OVER (PARTITION BY ds.state_name) as districts_in_state,
            -- Calculate percentile within state
            CASE 
                WHEN %s = TRUE THEN 
                    PERCENT_RANK() OVER (PARTITION BY ds.state_name ORDER BY {year_column} DESC) * 100
                ELSE 
                    PERCENT_RANK() OVER (PARTITION BY ds.state_name ORDER BY {year_column} ASC) * 100
            END as state_percentile
        FROM SDG_Goals_Data sgd
        JOIN SDG_Goals sg ON sgd.sdg_short_indicator_name = sg.sdg_short_indicator_name
        JOIN District_State ds ON sgd.district_name = ds.district_name
        WHERE sg.sdg_short_indicator_name = %s
        AND {year_column} IS NOT NULL
        ORDER BY ds.state_name, state_rank_best
        """
        
        cursor.execute(query, (higher_is_better, resolved_short_name))
        results = cursor.fetchall()
        
        if not results:
            return {"error": f"No data found for indicator '{indicator_name}' in {year}"}
        
        # Group results by state and extract best/worst performers
        state_results = {}
        
        for row in results:
            district_name = row[0]
            state_name = row[1]
            current_value = float(row[2]) if row[2] is not None else None
            previous_value = float(row[3]) if row[3] is not None else None
            annual_change = float(row[4]) if row[4] is not None else None
            rank_best = int(row[5])
            rank_worst = int(row[6])
            districts_count = int(row[7])
            state_percentile = float(row[8]) if row[8] is not None else None
            
            # Only include states with minimum number of districts
            if districts_count < min_districts_per_state:
                continue
            
            if state_name not in state_results:
                state_results[state_name] = {
                    "state_name": state_name,
                    "total_districts": districts_count,
                    "best_performer": None,
                    "worst_performer": None
                }
            
            district_data = {
                "district_name": district_name,
                "state_name": state_name,
                "current_value": current_value,
                "previous_value": previous_value,
                "annual_change": annual_change,
                "state_percentile": state_percentile,
                "rank_in_state": rank_best if rank_best == 1 else rank_worst
            }
            
            # Assign best and worst performers
            if rank_best == 1:
                state_results[state_name]["best_performer"] = district_data
            elif rank_worst == 1:
                state_results[state_name]["worst_performer"] = district_data
        
        # Convert to list and sort by state name
        final_results = []
        for state_data in sorted(state_results.values(), key=lambda x: x["state_name"]):
            if state_data["best_performer"] and state_data["worst_performer"]:
                final_results.append(state_data)
        
        # Generate analysis
        analysis = generate_state_wise_extremes_analysis(
            final_results, full_indicator_name, higher_is_better, year, include_aac
        )
        
        # Get boundary data for all districts
        all_districts = []
        for state_data in final_results:
            if state_data["best_performer"]:
                all_districts.append(state_data["best_performer"]["district_name"])
            if state_data["worst_performer"]:
                all_districts.append(state_data["worst_performer"]["district_name"])
        
        boundary_data = get_district_boundary_data(all_districts)
        
        result = {
            "indicator_name": resolved_short_name,  # Use resolved short name for consistency
            "indicator_full_name": full_indicator_name,
            "original_query": indicator_name,  # Keep original user input for reference
            "sdg_goal": sdg_goal,
            "higher_is_better": higher_is_better,
            "year": year,
            "states_analyzed": len(final_results),
            "total_districts": sum(state["total_districts"] for state in final_results),
            "state_results": final_results,
            "analysis": analysis,
            "boundary_data": boundary_data,
            "map_type": "state_wise_extremes"
        }
        
        cursor.close()
        conn.close()
        
        return result
        
    except Exception as e:
        return {"error": f"Error in state-wise indicator extremes analysis: {str(e)}"}

def generate_state_wise_extremes_analysis(state_results, indicator_name, higher_is_better, year, include_aac):
    """Generate comprehensive analysis for state-wise indicator extremes."""
    try:
        if not state_results:
            return "No data available for analysis"
        
        analysis_parts = []
        
        # Header
        direction = "higher values indicate better performance" if higher_is_better else "lower values indicate better performance"
        analysis_parts.append(f"### **State-wise Best and Worst Performers: {indicator_name} ({year})**\n")
        analysis_parts.append(f"*Note: For this indicator, {direction}*\n")
        
        # Summary statistics
        best_values = [state["best_performer"]["current_value"] for state in state_results 
                      if state["best_performer"]["current_value"] is not None]
        worst_values = [state["worst_performer"]["current_value"] for state in state_results 
                       if state["worst_performer"]["current_value"] is not None]
        
        if best_values and worst_values:
            analysis_parts.append(f"#### **Overall Summary**")
            analysis_parts.append(f"• **States analyzed**: {len(state_results)}")
            analysis_parts.append(f"• **Best performer range**: {min(best_values):.2f} to {max(best_values):.2f}")
            analysis_parts.append(f"• **Worst performer range**: {min(worst_values):.2f} to {max(worst_values):.2f}")
            
            # Identify standout performers
            if higher_is_better:
                top_best = max(best_values)
                top_worst = min(worst_values)
            else:
                top_best = min(best_values)
                top_worst = max(worst_values)
            
            best_state = next(state for state in state_results 
                            if state["best_performer"]["current_value"] == top_best)
            worst_state = next(state for state in state_results 
                             if state["worst_performer"]["current_value"] == top_worst)
            
            analysis_parts.append(f"• **Overall best district**: {best_state['best_performer']['district_name']}, {best_state['state_name']} ({top_best:.2f})")
            analysis_parts.append(f"• **Overall worst district**: {worst_state['worst_performer']['district_name']}, {worst_state['state_name']} ({top_worst:.2f})\n")
        
        # State-by-state breakdown
        analysis_parts.append("#### **State-by-State Analysis**\n")
        
        for state in sorted(state_results, key=lambda x: x["state_name"]):
            state_name = state["state_name"]
            best = state["best_performer"]
            worst = state["worst_performer"]
            
            analysis_parts.append(f"**{state_name}** ({state['total_districts']} districts)")
            
            if best and worst:
                analysis_parts.append(f"   • **Best**: {best['district_name']} - {best['current_value']:.2f}")
                analysis_parts.append(f"   • **Worst**: {worst['district_name']} - {worst['current_value']:.2f}")
                
                # Calculate performance gap
                if best['current_value'] is not None and worst['current_value'] is not None:
                    gap = abs(best['current_value'] - worst['current_value'])
                    analysis_parts.append(f"   • **Performance gap**: {gap:.2f}")
                
                # Include AAC analysis if requested
                if include_aac and best.get('annual_change') is not None and worst.get('annual_change') is not None:
                    best_trend = "improving" if (best['annual_change'] > 0 and higher_is_better) or (best['annual_change'] < 0 and not higher_is_better) else "declining"
                    worst_trend = "improving" if (worst['annual_change'] > 0 and higher_is_better) or (worst['annual_change'] < 0 and not higher_is_better) else "declining"
                    
                    analysis_parts.append(f"   • **Trends**: Best performer {best_trend} ({best['annual_change']:+.2f}), Worst performer {worst_trend} ({worst['annual_change']:+.2f})")
                
                analysis_parts.append("")
        
        # Key insights
        analysis_parts.append("#### **Key Insights**")
        
        # Identify states with largest gaps
        state_gaps = []
        for state in state_results:
            best_val = state["best_performer"]["current_value"]
            worst_val = state["worst_performer"]["current_value"]
            if best_val is not None and worst_val is not None:
                gap = abs(best_val - worst_val)
                state_gaps.append((state["state_name"], gap))
        
        if state_gaps:
            state_gaps.sort(key=lambda x: x[1], reverse=True)
            largest_gap_state = state_gaps[0]
            smallest_gap_state = state_gaps[-1]
            
            analysis_parts.append(f"• **Largest intra-state disparity**: {largest_gap_state[0]} (gap: {largest_gap_state[1]:.2f})")
            analysis_parts.append(f"• **Most consistent state**: {smallest_gap_state[0]} (gap: {smallest_gap_state[1]:.2f})")
        
        # AAC trends summary
        if include_aac:
            improving_best = 0
            improving_worst = 0
            
            for state in state_results:
                best_aac = state["best_performer"].get("annual_change")
                worst_aac = state["worst_performer"].get("annual_change")
                
                if best_aac is not None:
                    if (best_aac > 0 and higher_is_better) or (best_aac < 0 and not higher_is_better):
                        improving_best += 1
                
                if worst_aac is not None:
                    if (worst_aac > 0 and higher_is_better) or (worst_aac < 0 and not higher_is_better):
                        improving_worst += 1
            
            analysis_parts.append(f"• **Improvement trends**: {improving_best}/{len(state_results)} best performers improving, {improving_worst}/{len(state_results)} worst performers improving")
        
        return "\n".join(analysis_parts)
        
    except Exception as e:
        print(f"Error generating state-wise extremes analysis: {e}")
        return f"Analysis could not be generated: {str(e)}"

def get_most_least_improved_districts(
    sdg_goal_number: int,
    indicator_name: str = None,
    query_type: str = "most_improved",  # "most_improved" or "least_improved"
    top_n: int = 5,
    state_name: str = None,
    user_query: str = None  # Optional: for intelligent query analysis
):
    """
    Return districts with the most or least improvement (annual change) for a given SDG goal or indicator.
    - sdg_goal_number: SDG goal number (1-17)
    - indicator_name: Optional specific indicator name (if None, use all indicators for the goal)
    - query_type: 'most_improved' or 'least_improved' (can be auto-detected from user_query)
    - top_n: Number of districts to return (can be auto-extracted from user_query)
    - state_name: Optional state filter
    - user_query: Optional raw user query for intelligent intent analysis
    """
    try:
        # Apply intelligent query analysis if user_query is provided
        if user_query:
            intent_analysis = analyze_improvement_query_intent(user_query)
            
            # Override parameters based on intelligent analysis if confidence is high enough
            if intent_analysis["confidence"] > 0.5:
                query_type = intent_analysis["query_type"]
                print(f"Query intent analysis: {intent_analysis['query_type']} (confidence: {intent_analysis['confidence']:.2f})")
                print(f"Detected terms: {intent_analysis['detected_terms']}")
            
            # Use extracted top_n if it's reasonable and different from default
            if intent_analysis["top_n"] != 5 and 1 <= intent_analysis["top_n"] <= 20:
                top_n = intent_analysis["top_n"]
                print(f"Using extracted top_n: {top_n}")
        
        conn = get_db_connection()
        cursor = conn.cursor()

        # Build base conditions
        conditions = ["sgd.nfhs_value_4 IS NOT NULL", "sgd.nfhs_value_5 IS NOT NULL"]
        params = []

        if sdg_goal_number:
            conditions.append("sg.major_sdg_goal = %s")
            params.append(sdg_goal_number)
        if indicator_name:
            conditions.append("sg.sdg_short_indicator_name ILIKE %s")
            params.append(f"%{indicator_name}%")
        if state_name:
            conditions.append("ds.state_name ILIKE %s")
            params.append(f"%{state_name}%")

        base_condition = " AND ".join(conditions)

        # Determine if we need balanced results per indicator (when no specific indicator is provided)
        if not indicator_name:
            # Get balanced results per indicator
            query = f"""
            WITH ranked_districts AS (
                SELECT 
                    sgd.district_name,
                    ds.state_name,
                    sg.sdg_short_indicator_name,
                    sg.sdg_full_indicator_name,
                    sg.major_sdg_goal,
                    sgd.nfhs_value_4,
                    sgd.nfhs_value_5,
                    sgd.actual_annual_change,
                    COALESCE(sg.higher_is_better, FALSE) as higher_is_better,
                    sgd.aspirational_status,
                    sgd.district_sdg_status,
                    -- Calculate improvement score based on indicator direction
                    CASE 
                        WHEN COALESCE(sg.higher_is_better, FALSE) = TRUE THEN 
                            sgd.actual_annual_change  -- For higher_is_better, positive change = improvement
                        ELSE 
                            -sgd.actual_annual_change  -- For lower_is_better, negative change = improvement
                    END as improvement_score,
                    -- Rank within each indicator
                    ROW_NUMBER() OVER (
                        PARTITION BY sg.sdg_short_indicator_name 
                        ORDER BY 
                            CASE 
                                WHEN COALESCE(sg.higher_is_better, FALSE) = TRUE THEN 
                                    sgd.actual_annual_change
                                ELSE 
                                    -sgd.actual_annual_change
                            END {"DESC" if query_type == "most_improved" else "ASC"}
                    ) as indicator_rank
                FROM SDG_Goals_Data sgd
                JOIN SDG_Goals sg ON sgd.sdg_short_indicator_name = sg.sdg_short_indicator_name
                JOIN District_State ds ON sgd.district_name = ds.district_name
                WHERE {base_condition}
            )
            SELECT 
                district_name, state_name, sdg_short_indicator_name, sdg_full_indicator_name,
                major_sdg_goal, nfhs_value_4, nfhs_value_5, actual_annual_change,
                higher_is_better, aspirational_status, district_sdg_status, improvement_score
            FROM ranked_districts
            WHERE indicator_rank <= GREATEST(1, %s / (
                SELECT COUNT(DISTINCT sdg_short_indicator_name) 
                FROM SDG_Goals 
                WHERE major_sdg_goal = %s
            ))
            ORDER BY improvement_score {"DESC" if query_type == "most_improved" else "ASC"}
            LIMIT %s
            """
            params.extend([top_n, sdg_goal_number, top_n])
        else:
            # Original query for specific indicator
            query = f"""
            SELECT 
                sgd.district_name,
                ds.state_name,
                sg.sdg_short_indicator_name,
                sg.sdg_full_indicator_name,
                sg.major_sdg_goal,
                sgd.nfhs_value_4,
                sgd.nfhs_value_5,
                sgd.actual_annual_change,
                COALESCE(sg.higher_is_better, FALSE) as higher_is_better,
                sgd.aspirational_status,
                sgd.district_sdg_status,
                -- Calculate improvement score based on indicator direction
                CASE 
                    WHEN COALESCE(sg.higher_is_better, FALSE) = TRUE THEN 
                        sgd.actual_annual_change  -- For higher_is_better, positive change = improvement
                    ELSE 
                        -sgd.actual_annual_change  -- For lower_is_better, negative change = improvement
                END as improvement_score
            FROM SDG_Goals_Data sgd
            JOIN SDG_Goals sg ON sgd.sdg_short_indicator_name = sg.sdg_short_indicator_name
            JOIN District_State ds ON sgd.district_name = ds.district_name
            WHERE {base_condition}
            ORDER BY improvement_score {"DESC" if query_type == "most_improved" else "ASC"}
            LIMIT %s
            """
            params.append(top_n)

        cursor.execute(query, params)
        results = cursor.fetchall()

        if not results:
            return {
                "error": "No improvement data found for the specified criteria",
                "sdg_goal": sdg_goal_number,
                "indicator": indicator_name
            }

        formatted_results = []
        for row in results:
            annual_change = float(row[7]) if row[7] is not None else None
            higher_is_better = row[8]
            improvement_score = float(row[11]) if row[11] is not None else None
            
            # Determine if this represents an improvement based on indicator direction
            is_improvement = None
            if annual_change is not None:
                if higher_is_better:
                    is_improvement = annual_change > 0
                else:
                    is_improvement = annual_change < 0
            
            result_data = {
                "district": row[0],
                "state": row[1],
                "indicator_name": row[2],
                "indicator_full_name": row[3],
                "sdg_goal": row[4],
                "nfhs_4_value": float(row[5]) if row[5] is not None else None,
                "nfhs_5_value": float(row[6]) if row[6] is not None else None,
                "annual_change": annual_change,
                "higher_is_better": higher_is_better,
                "aspirational_status": row[9],
                "district_sdg_status": row[10],
                "improvement_score": improvement_score,
                "is_improvement": is_improvement,
                "change_interpretation": {
                    "is_improvement": is_improvement,
                    "description": f"{'Improved' if is_improvement else 'Declined' if is_improvement is False else 'No change'} (annual change: {annual_change:.2f})" if annual_change is not None else "No data"
                }
            }
            formatted_results.append(result_data)

        # Get boundary data for all districts in the results
        all_districts = [result[0] for result in results]
        boundary_data = get_district_boundary_data(all_districts) if all_districts else []

        cursor.close()
        conn.close()

        # Calculate indicator distribution for better insights
        indicator_distribution = {}
        if formatted_results:
            for result in formatted_results:
                indicator = result['indicator_name']
                if indicator not in indicator_distribution:
                    indicator_distribution[indicator] = []
                indicator_distribution[indicator].append(result)

        # Add query analysis info to response if user_query was provided
        response_data = {
            "success": True,
            "query_type": query_type,
            "sdg_goal": sdg_goal_number,
            "indicator": indicator_name,
            "state_filter": state_name,
            "total_districts": len(formatted_results),
            "data": formatted_results,
            "boundary": boundary_data,
            "map_type": "improvement_analysis",
            "indicator_distribution": {
                indicator: {
                    "count": len(districts),
                    "districts": [d['district'] for d in districts],
                    "avg_improvement_score": sum(d['improvement_score'] for d in districts if d['improvement_score'] is not None) / len([d for d in districts if d['improvement_score'] is not None]) if any(d['improvement_score'] is not None for d in districts) else None
                }
                for indicator, districts in indicator_distribution.items()
            } if not indicator_name else None,  # Only show distribution when querying all indicators
            "balanced_per_indicator": not bool(indicator_name)  # Flag to indicate balanced approach was used
        }
        
        # Include query analysis information if available
        if user_query:
            intent_analysis = analyze_improvement_query_intent(user_query)
            response_data["query_analysis"] = {
                "original_query": user_query,
                "detected_intent": intent_analysis["query_type"],
                "confidence": intent_analysis["confidence"],
                "detected_terms": intent_analysis["detected_terms"],
                "has_improvement_intent": intent_analysis["has_improvement_intent"]
            }
        
        return response_data
    except Exception as e:
        return {"error": f"Error in most/least improved districts: {str(e)}"}

def analyze_improvement_query_intent(user_query: str):
    """
    Analyze user query to determine improvement/decline intent and extract parameters.
    Handles various ways users might express improvement or decline concepts.
    
    Returns:
    - query_type: "most_improved" or "least_improved" 
    - confidence: float (0-1) indicating confidence in the classification
    - detected_terms: list of matched terms
    - top_n: extracted number if present
    """
    import re
    
    query_lower = user_query.lower()
    
    # Define comprehensive improvement terminology
    improvement_keywords = {
        "most_improved": [
            # Direct improvement terms
            "most improved", "highest improving", "best improvement", "greatest improvement",
            "biggest improvement", "fastest improvement", "most progress", "best progress",
            "greatest gains", "highest gains", "most advancing", "best advancing",
            
            # Comparative improvement
            "improved most", "progressed most", "advanced most", "gained most",
            "increased most", "enhanced most", "bettered most",
            
            # Superlative forms
            "top improving", "leading improvement", "superior progress",
            "excellent progress", "outstanding improvement", "remarkable progress",
            
            # Growth/positive change
            "fastest growing", "rapid improvement", "significant improvement",
            "substantial progress", "notable improvement", "major progress"
        ],
        
        "least_improved": [
            # Direct decline terms  
            "least improved", "worst improvement", "poorest improvement", "lowest improving",
            "smallest improvement", "minimal improvement", "declining", "deteriorating",
            "worsening", "regressing", "degrading", "falling behind",
            
            # Negative progress
            "worst progress", "poor progress", "negative progress", "backward progress",
            "losing ground", "going backwards", "getting worse", "performing worse",
            
            # Stagnation terms
            "stagnant", "stagnating", "not improving", "no improvement", "no progress",
            "unchanged", "static", "plateaued", "flat performance",
            
            # Comparative decline
            "declined most", "dropped most", "decreased most", "reduced most",
            "weakened most", "slipped most", "fallen most"
        ]
    }
    
    # Track matches and confidence
    matches = {"most_improved": [], "least_improved": []}
    
    # Check for keyword matches
    for category, keywords in improvement_keywords.items():
        for keyword in keywords:
            if keyword in query_lower:
                matches[category].append(keyword)
    
    # Extract numbers for top_n
    number_patterns = [
        r"top\s+(\d+)", r"(\d+)\s+most", r"(\d+)\s+best", r"(\d+)\s+worst",
        r"(\d+)\s+districts", r"show\s+(\d+)", r"list\s+(\d+)", r"first\s+(\d+)",
        r"(\d+)\s+improving", r"(\d+)\s+declining"
    ]
    
    top_n = 5  # default
    for pattern in number_patterns:
        match = re.search(pattern, query_lower)
        if match:
            top_n = int(match.group(1))
            break
    
    # Determine query type based on matches
    most_improved_count = len(matches["most_improved"])
    least_improved_count = len(matches["least_improved"])
    
    if most_improved_count > least_improved_count:
        query_type = "most_improved"
        confidence = min(0.9, 0.3 + (most_improved_count * 0.2))
        detected_terms = matches["most_improved"]
    elif least_improved_count > most_improved_count:
        query_type = "least_improved" 
        confidence = min(0.9, 0.3 + (least_improved_count * 0.2))
        detected_terms = matches["least_improved"]
    else:
        # Default to most_improved if no clear indication
        query_type = "most_improved"
        confidence = 0.1
        detected_terms = []
    
    # Boost confidence for very specific terms
    high_confidence_terms = [
        "most improved", "least improved", "declining", "deteriorating", 
        "best improvement", "worst improvement", "greatest improvement"
    ]
    
    if any(term in query_lower for term in high_confidence_terms):
        confidence = max(confidence, 0.8)
    
    return {
        "query_type": query_type,
        "confidence": confidence,
        "detected_terms": detected_terms,
        "top_n": top_n,
        "has_improvement_intent": confidence > 0.3,
        "all_matches": matches
    }

def get_border_districts(
    state1: str,
    state2: str = None,
    sdg_goal_number: Optional[int] = None,
    indicator_names: Optional[List[str]] = None,
    year: int = 2021,
    include_boundary_data: bool = True
):
    """
    Get districts that neighbor a state (but aren't in it) with their SDG performance data.
    
    Args:
        state1: State name to find neighboring districts for
        state2: Deprecated - kept for backward compatibility
        sdg_goal_number: Optional SDG goal number for focused analysis
        indicator_names: Optional list of specific indicators
        year: Year for analysis (2016 or 2021)
        include_boundary_data: Whether to include boundary geometry data
        
    Returns:
        Dictionary with neighboring districts data and analysis
    """
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        
        # Find districts that neighbor the state but aren't in it
        border_query = """
        WITH state_boundary AS (
            SELECT ST_Union(geom) as state_geom
            FROM District_Geometry 
            WHERE UPPER(TRIM(state_name)) = UPPER(TRIM(%s))
        ),
        neighboring_districts AS (
            SELECT DISTINCT 
                d.district_name,
                d.state_name,
                d.area_sqkm,
                d.perimeter_km,
                d.geom,
                ST_Length(ST_Intersection(ST_Boundary(d.geom), s.state_geom)::geography)/1000 as shared_boundary_length_km
            FROM District_Geometry d
            CROSS JOIN state_boundary s
            WHERE UPPER(TRIM(d.state_name)) != UPPER(TRIM(%s))
            AND ST_Intersects(ST_Boundary(d.geom), s.state_geom)
            AND ST_Length(ST_Intersection(ST_Boundary(d.geom), s.state_geom)::geography) > 0
        )
        SELECT district_name, state_name, area_sqkm, perimeter_km, shared_boundary_length_km
        FROM neighboring_districts
        ORDER BY state_name, shared_boundary_length_km DESC
        """
        cursor.execute(border_query, [state1, state1])
        
        border_results = cursor.fetchall()
        
        if not border_results:
            return {
                "success": False,
                "message": f"No districts found neighboring {state1}",
                "border_districts": [],
                "total_districts": 0
            }
        
        # Extract district names for SDG data lookup
        border_districts_info = []
        district_names = []
        state_counts = {}
        
        for row in border_results:
            district_info = {
                "district_name": row[0],
                "state_name": row[1],
                "area_sqkm": float(row[2]) if row[2] else None,
                "perimeter_km": float(row[3]) if row[3] else None,
                "shared_boundary_km": float(row[4]) if row[4] else None  # Already in kilometers from the query
            }
            border_districts_info.append(district_info)
            district_names.append(row[0])
            
            # Count districts per state
            if row[1] not in state_counts:
                state_counts[row[1]] = 0
            state_counts[row[1]] += 1
        
        # Get SDG data for border districts
        if sdg_goal_number:
            # Use specific SDG goal
            if indicator_names:
                # Get data for specific indicators
                placeholders = ','.join(['%s'] * len(district_names))
                indicator_placeholders = ','.join(['%s'] * len(indicator_names))
                
                year_column = "nfhs_value_5" if year == 2021 else "nfhs_value_4"
                
                sdg_query = f"""
                SELECT 
                    sgd.district_name,
                    ds.state_name,
                    sg.sdg_short_indicator_name,
                    sg.sdg_full_indicator_name,
                    sgd.{year_column} as current_value,
                    sg.major_sdg_goal,
                    sg.higher_is_better,
                    sgd.nfhs_value_4,
                    sgd.nfhs_value_5,
                    sgd.actual_annual_change
                FROM SDG_Goals_Data sgd
                JOIN SDG_Goals sg ON sgd.sdg_short_indicator_name = sg.sdg_short_indicator_name
                JOIN District_State ds ON sgd.district_name = ds.district_name
                WHERE sgd.district_name IN ({placeholders})
                AND sg.sdg_short_indicator_name IN ({indicator_placeholders})
                AND sg.major_sdg_goal = %s
                AND sgd.{year_column} IS NOT NULL
                ORDER BY ds.state_name, sgd.district_name, sg.sdg_indicator_number
                """
                
                params = district_names + indicator_names + [sdg_goal_number]
                cursor.execute(sdg_query, params)
            else:
                # Get all indicators for the SDG goal
                placeholders = ','.join(['%s'] * len(district_names))
                
                year_column = "nfhs_value_5" if year == 2021 else "nfhs_value_4"
                
                sdg_query = f"""
                SELECT 
                    sgd.district_name,
                    ds.state_name,
                    sg.sdg_short_indicator_name,
                    sg.sdg_full_indicator_name,
                    sgd.{year_column} as current_value,
                    sg.major_sdg_goal,
                    sg.higher_is_better,
                    sgd.nfhs_value_4,
                    sgd.nfhs_value_5,
                    sgd.actual_annual_change
                FROM SDG_Goals_Data sgd
                JOIN SDG_Goals sg ON sgd.sdg_short_indicator_name = sg.sdg_short_indicator_name
                JOIN District_State ds ON sgd.district_name = ds.district_name
                WHERE sgd.district_name IN ({placeholders})
                AND sg.major_sdg_goal = %s
                AND sgd.{year_column} IS NOT NULL
                ORDER BY ds.state_name, sgd.district_name, sg.sdg_indicator_number
                """
                
                params = district_names + [sdg_goal_number]
                cursor.execute(sdg_query, params)
        else:
            # Get all available SDG data for these districts
            placeholders = ','.join(['%s'] * len(district_names))
            
            year_column = "nfhs_value_5" if year == 2021 else "nfhs_value_4"
            
            sdg_query = f"""
            SELECT 
                sgd.district_name,
                ds.state_name,
                sg.sdg_short_indicator_name,
                sg.sdg_full_indicator_name,
                sgd.{year_column} as current_value,
                sg.major_sdg_goal,
                sg.higher_is_better,
                sgd.nfhs_value_4,
                sgd.nfhs_value_5,
                sgd.actual_annual_change
            FROM SDG_Goals_Data sgd
            JOIN SDG_Goals sg ON sgd.sdg_short_indicator_name = sg.sdg_short_indicator_name
            JOIN District_State ds ON sgd.district_name = ds.district_name
            WHERE sgd.district_name IN ({placeholders})
            AND sgd.{year_column} IS NOT NULL
            ORDER BY ds.state_name, sgd.district_name, sg.major_sdg_goal, sg.sdg_indicator_number
            """
            
            params = district_names
            cursor.execute(sdg_query, params)
        
        sdg_results = cursor.fetchall()
        
        # Organize data by district
        districts_data = {}
        
        for district_info in border_districts_info:
            district_key = f"{district_info['district_name']}_{district_info['state_name']}"
            districts_data[district_key] = {
                "district_name": district_info["district_name"],
                "state_name": district_info["state_name"],
                "area_sqkm": district_info["area_sqkm"],
                "perimeter_km": district_info["perimeter_km"],
                "shared_boundary_km": district_info["shared_boundary_km"],
                "indicators": []
            }
        
        # Add SDG data to districts
        for row in sdg_results:
            district_key = f"{row[0]}_{row[1]}"
            if district_key in districts_data:
                indicator_data = {
                    "indicator_name": row[2],
                    "indicator_full_name": row[3],
                    "current_value": float(row[4]) if row[4] is not None else None,
                    "sdg_goal": row[5],
                    "higher_is_better": row[6],
                    "nfhs_4_value": float(row[7]) if row[7] is not None else None,
                    "nfhs_5_value": float(row[8]) if row[8] is not None else None,
                    "actual_annual_change": float(row[9]) if row[9] is not None else None
                }
                districts_data[district_key]["indicators"].append(indicator_data)
        
        # Convert to list format
        final_districts = list(districts_data.values())
        
        # Generate comprehensive enhanced analysis
        analysis_parts = []
        
        # Calculate total shared boundary length and state-wise metrics
        total_shared_boundary = sum(d.get("shared_boundary_km", 0) or 0 for d in final_districts)
        state_metrics = {}
        
        for state, count in state_counts.items():
            state_districts = [d for d in final_districts if d["state_name"] == state]
            state_boundary = sum(d.get("shared_boundary_km", 0) or 0 for d in state_districts)
            longest_boundary_district = max(state_districts, key=lambda x: x.get("shared_boundary_km", 0) or 0)
            
            state_metrics[state] = {
                "district_count": count,
                "total_boundary_km": state_boundary,
                "longest_boundary_district": longest_boundary_district["district_name"],
                "longest_boundary_km": longest_boundary_district.get("shared_boundary_km", 0) or 0,
                "districts": [
                    {
                        "name": d["district_name"],
                        "shared_boundary_km": d.get("shared_boundary_km", 0) or 0
                    } for d in sorted(state_districts, key=lambda x: x.get("shared_boundary_km", 0) or 0, reverse=True)
                ]
            }
        
        # Header
        analysis_parts.append(f"### {state1} Border Districts ({year})")
        analysis_parts.append("")
        
        # Main summary with geographic context
        neighboring_states_list = ", ".join(state_counts.keys())
        analysis_parts.append(f"{state1} shares its borders with {len(state_counts)} {'state' if len(state_counts) == 1 else 'states'}: {neighboring_states_list}. Let's review the performance of these border districts concerning SDG {sdg_goal_number or 'indicators'}:")
        analysis_parts.append("")
        
        # Detailed state-wise breakdown with key insights
        for state, metrics in state_metrics.items():
            analysis_parts.append(f"#### {state} Border Districts")
            analysis_parts.append("")
            
            # Find districts with SDG data for detailed analysis
            state_districts_with_data = [d for d in final_districts if d["state_name"] == state and d["indicators"]]
            
            if state_districts_with_data:
                # Detailed district analysis
                for district in sorted(state_districts_with_data, key=lambda x: x.get("shared_boundary_km", 0) or 0, reverse=True)[:3]:  # Top 3 by boundary length
                    district_name = district["district_name"]
                    boundary_km = district.get("shared_boundary_km", 0) or 0
                    
                    # Find key indicators for this district
                    key_indicators = []
                    trend_indicators = []
                    
                    for indicator in district["indicators"]:
                        if indicator["current_value"] is not None:
                            key_indicators.append(indicator)
                            
                            # Check for significant trends
                            if (indicator.get("actual_annual_change") is not None and 
                                abs(indicator["actual_annual_change"]) > 1.0):  # Significant change threshold
                                trend_indicators.append(indicator)
        
                    if key_indicators:
                        analysis_parts.append(f"**{district_name}**: ")
                        
                        # Add specific findings based on indicator performance
                        if sdg_goal_number == 1:  # Poverty indicators
                            poverty_indicators = [ind for ind in key_indicators if any(keyword in ind["indicator_name"].lower() 
                                                for keyword in ["poverty", "multidimensional", "below poverty"])]
                            if poverty_indicators:
                                for ind in poverty_indicators[:2]:  # Top 2 relevant indicators
                                    value = ind["current_value"]
                                    change = ind.get("actual_annual_change", 0) or 0
                                    
                                    if "multidimensional" in ind["indicator_name"].lower():
                                        if value < 20:
                                            trend_desc = "low poverty levels"
                                        elif value < 40:
                                            trend_desc = "moderate poverty levels"
                                        else:
                                            trend_desc = "high poverty levels"
                                    else:
                                        trend_desc = f"indicator value of {value:.1f}%"
                                    
                                    change_desc = ""
                                    if abs(change) > 0.5:
                                        direction = "reduction" if change < 0 else "increase"
                                        change_desc = f", achieving an annual poverty {direction} of {abs(change):.2f}%"
                                    
                                    # Extract years for trend analysis
                                    nfhs4_val = ind.get("nfhs_4_value")
                                    nfhs5_val = ind.get("nfhs_5_value")
                                    if nfhs4_val and nfhs5_val:
                                        overall_change = nfhs5_val - nfhs4_val
                                        if abs(overall_change) > 2:
                                            change_desc += f" from {nfhs4_val:.1f}% in NFHS-4 to {nfhs5_val:.1f}% in NFHS-5"
                                    
                                    analysis_parts.append(f"Notable {'reduction' if 'multidimensional' in ind['indicator_name'].lower() and change < 0 else 'change'} in {ind['indicator_name'].lower()} {trend_desc}{change_desc}.")
                        
                        elif sdg_goal_number == 3:  # Health indicators
                            health_indicators = [ind for ind in key_indicators if any(keyword in ind["indicator_name"].lower() 
                                               for keyword in ["mortality", "birth", "skilled", "immunization", "health"])]
                            if health_indicators:
                                for ind in health_indicators[:2]:
                                    value = ind["current_value"]
                                    change = ind.get("actual_annual_change", 0) or 0
                                    change_desc = ""
                                    if abs(change) > 0.5:
                                        direction = "improvement" if (change > 0 and ind.get("higher_is_better")) or (change < 0 and not ind.get("higher_is_better")) else "decline"
                                        change_desc = f" with annual {direction} of {abs(change):.2f}%"
                                    
                                    analysis_parts.append(f"Shows {ind['indicator_name'].lower()} of {value:.1f}%{change_desc}.")
                        
                        else:  # General SDG indicators
                            for ind in key_indicators[:2]:
                                value = ind["current_value"]
                                change = ind.get("actual_annual_change", 0) or 0
                                change_desc = ""
                                if abs(change) > 0.5:
                                    change_desc = f" (annual change: {change:+.2f}%)"
                                
                                analysis_parts.append(f"{ind['indicator_name']}: {value:.1f}%{change_desc}.")
                        
                        # Add boundary information
                        if boundary_km > 0:
                            analysis_parts.append(f"Border length with {state1}: {boundary_km:.1f} km.")
                    
                    analysis_parts.append("")
        
                # Add remaining districts summary if more than 3
                if len(state_districts_with_data) > 3:
                    remaining = len(state_districts_with_data) - 3
                    remaining_names = [d["district_name"] for d in state_districts_with_data[3:]]
                    analysis_parts.append(f"**{', '.join(remaining_names[:3])}{'...' if remaining > 3 else ''}**: These districts also show {'improvements' if sdg_goal_number == 1 else 'performance indicators'} {'in poverty reduction and health insurance coverage' if sdg_goal_number == 1 else 'demonstrating'}, demonstrating {'a positive trend in tackling poverty-associated issues' if sdg_goal_number == 1 else 'ongoing efforts'}.")
                    analysis_parts.append("")
                            
                else:
                    analysis_parts.append(f"**{metrics['longest_boundary_district']}**: Shares {metrics['longest_boundary_km']:.1f} km border with {state1}.")
                    analysis_parts.append("")
        
        # Key insights section
        if sdg_goal_number:
            analysis_parts.append("### Key Insights:")
            analysis_parts.append("")
            
            # Performance comparison
            if len(state_metrics) > 1:
                # Find best and worst performing states
                state_performance = {}
                for district in final_districts:
                    state = district['state_name']
                    if state not in state_performance:
                        state_performance[state] = []
                    
                    if district['indicators']:
                        valid_values = [ind['current_value'] for ind in district['indicators'] 
                                      if ind['current_value'] is not None]
                        if valid_values:
                            avg_performance = sum(valid_values) / len(valid_values)
                            state_performance[state].append(avg_performance)
                
                if state_performance:
                    state_averages = {state: sum(perfs)/len(perfs) for state, perfs in state_performance.items() if perfs}
                    
                    if state_averages:
                        best_state = min(state_averages, key=state_averages.get) if sdg_goal_number == 1 else max(state_averages, key=state_averages.get)
                        worst_state = max(state_averages, key=state_averages.get) if sdg_goal_number == 1 else min(state_averages, key=state_averages.get)
                        
                        analysis_parts.append(f"**{state1}'s border districts** with {', '.join([s for s in state_metrics.keys() if s != worst_state])} have shown {'promising trends in poverty reduction' if sdg_goal_number == 1 else 'better performance indicators'}, which might enhance access to {'healthcare and social services' if sdg_goal_number == 1 else 'essential services'}.")
                        analysis_parts.append("")
                        
                        if sdg_goal_number == 1:
                            analysis_parts.append(f"**{best_state}'s neighboring districts** have exhibited impressive reductions in poverty levels, which is likely to improve health outcomes due to enhanced access to healthcare services and coverage.")
                        elif sdg_goal_number == 3:
                            analysis_parts.append(f"**{best_state}'s neighboring districts** show superior health indicators, potentially due to better healthcare infrastructure and service delivery.")
                        
                        analysis_parts.append("")
            
            # Policy implications
            analysis_parts.append("These insights provide valuable context for policymakers to design targeted interventions to further improve " + 
                               ("poverty and health outcomes" if sdg_goal_number == 1 else f"SDG {sdg_goal_number} indicators") + 
                               f" in the border regions of {state1}.")
        
        enhanced_analysis = "\n".join(analysis_parts)
        
        # Get boundary data using existing function
        boundary_data = []
        if include_boundary_data:
            boundary_data = get_district_boundary_data(district_names)
        
        cursor.close()
        conn.close()
        
        return {
            "success": True,
            "query_type": "border_districts",
            "state": state1,
            "sdg_goal_number": sdg_goal_number,
            "indicator_names": indicator_names,
            "year": year,
            "total_districts": len(final_districts),
            "total_shared_boundary_km": total_shared_boundary,
            "data": final_districts,
            "state_metrics": state_metrics,
            "boundary_data": boundary_data,
            "enhanced_analysis": enhanced_analysis,
            "map_type": "border_districts"
        }
        
    except Exception as e:
        return {
            "success": False,
            "error": str(e),
            "message": f"Error analyzing border districts: {str(e)}"
        }

def get_districts_within_radius(
    center_point: str,  # Either district name or "lat,lng" coordinates
    radius_km: float,
    sdg_goal_number: Optional[int] = None,
    indicator_names: Optional[List[str]] = None,
    max_districts: int = 50,
    include_boundary_data: bool = True
):
    """
    Find all districts within a specified radius from a center point and analyze their SDG performance.
    
    Parameters:
    - center_point: Either a district name (e.g., "Delhi") or coordinates as "lat,lng" (e.g., "28.6139,77.2090")
    - radius_km: Radius in kilometers to search within
    - sdg_goal_number: Optional SDG goal number (1-17) for focused analysis
    - indicator_names: Optional list of specific indicator names
    - max_districts: Maximum number of districts to return (default: 50)
    - include_boundary_data: Whether to include boundary geometry data for mapping
    
    Returns comprehensive data with both 2016 and 2021 values plus AAC for all districts within radius
    """
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        
        # Determine if center_point is coordinates or district name
        if ',' in center_point and len(center_point.split(',')) == 2:
            # Coordinates provided (lat,lng)
            try:
                lat, lng = map(float, center_point.split(','))
                center_type = "coordinates"
                center_name = f"Point({lat}, {lng})"
            except ValueError:
                return {"error": f"Invalid coordinates format: {center_point}. Use 'lat,lng' format."}
        else:
            # District name provided
            resolved_district = resolve_district_name(cursor, center_point)
            if not resolved_district:
                return {"error": f"District '{center_point}' not found"}
            
            center_type = "district"
            center_name = resolved_district["district_name"]
            center_state = resolved_district["state_name"]
            lat, lng = None, None  # Will be retrieved from database
        
        # Find districts within radius
        if center_type == "coordinates":
            # Use provided coordinates
            districts_in_radius = find_districts_within_radius_from_coordinates(
                cursor, lat, lng, radius_km, max_districts
            )
        else:
            # Use district centroid as center
            districts_in_radius = find_districts_within_radius_from_district(
                cursor, center_name, radius_km, max_districts
            )
        
        if not districts_in_radius:
            return {
                "error": f"No districts found within {radius_km} km of {center_name}",
                "center_point": center_name,
                "radius_km": radius_km
            }
        
        district_names = [d["district_name"] for d in districts_in_radius]
        
        # Get performance data for all districts with both years
        if sdg_goal_number and indicator_names:
            # Specific indicators requested
            performance_data = get_districts_multi_year_indicator_data(
                cursor, district_names, sdg_goal_number, indicator_names
            )
        elif sdg_goal_number:
            # Get all available indicators for this SDG goal
            available_indicators = get_indicators_by_sdg_goal(sdg_goal_number)
            if available_indicators and available_indicators.get("indicators"):
                all_indicator_names = [ind["short_name"] for ind in available_indicators["indicators"]]
                performance_data = get_districts_multi_year_indicator_data(
                    cursor, district_names, sdg_goal_number, all_indicator_names
                )
            else:
                performance_data = get_districts_multi_year_overall_data(
                    cursor, district_names, sdg_goal_number
                )
        elif indicator_names:
            # Specific indicators without SDG goal - find the goal first
            if len(indicator_names) == 1:
                cursor.execute(
                    "SELECT major_sdg_goal FROM SDG_Goals WHERE sdg_short_indicator_name = %s",
                    (indicator_names[0],)
                )
                result = cursor.fetchone()
                if result:
                    sdg_goal_number = result[0]
                    performance_data = get_districts_multi_year_indicator_data(
                        cursor, district_names, sdg_goal_number, indicator_names
                    )
                else:
                    return {"error": f"Indicator '{indicator_names[0]}' not found"}
            else:
                return {"error": "Multiple indicators require specifying an SDG goal"}
        else:
            # Multi-goal overview with both years
            performance_data = get_districts_multi_year_multi_goal_data(cursor, district_names)
        
        # Add distance information to performance data
        for perf_data in performance_data:
            for radius_data in districts_in_radius:
                if perf_data["district_name"] == radius_data["district_name"]:
                    perf_data["distance_km"] = radius_data["distance_km"]
                    break
        
        # Sort by distance
        performance_data.sort(key=lambda x: x.get("distance_km", float('inf')))
        
        # Generate analysis
        analysis = generate_radius_analysis(
            center_name, center_type, radius_km, performance_data, 
            sdg_goal_number, indicator_names
        )
        
        # Get boundary data for visualization if requested
        boundary_data = None
        if include_boundary_data:
            district_names_for_boundaries = [normalize_district_name(d['district_name']) for d in performance_data]
            boundary_data = get_district_boundary_data(district_names_for_boundaries)

        result = {
            "center_point": center_name,
            "center_type": center_type,
            "radius_km": radius_km,
            "districts_found": len(performance_data),
            "districts": performance_data,
            "analysis": analysis,
            "boundary_data": boundary_data,
            "map_type": "radius_analysis",
            "sdg_goal": sdg_goal_number,
            "indicators": indicator_names
        }
        
        if center_type == "district":
            result["center_state"] = center_state
            # Add the actual coordinates of the center district
            cursor.execute("""
                SELECT ST_X(centroid) as lng, ST_Y(centroid) as lat 
                FROM District_Geometry 
                WHERE UPPER(TRIM(district_name)) = %s
            """, (normalize_district_name(center_name),))
            coord_result = cursor.fetchone()
            if coord_result:
                result["center_coordinates"] = {"lat": float(coord_result[1]), "lng": float(coord_result[0])}
        else:
            result["center_coordinates"] = {"lat": lat, "lng": lng}
        
        cursor.close()
        conn.close()
        
        return result
        
    except Exception as e:
        return {"error": f"Error in districts within radius analysis: {str(e)}"}

def find_districts_within_radius_from_coordinates(cursor, lat, lng, radius_km, max_districts):
    """Find districts within radius from given coordinates."""
    try:
        query = """
        SELECT 
            dg.district_name,
            ds.state_name,
            CAST(ST_Distance(
                ST_Transform(ST_SetSRID(ST_MakePoint(%s, %s), 4326), 3857),
                ST_Transform(dg.centroid, 3857)
            )/1000.0 AS NUMERIC(10,2)) as distance_km
        FROM District_Geometry dg
        JOIN District_State ds ON dg.district_name = ds.district_name
        WHERE ST_DWithin(
            ST_Transform(ST_SetSRID(ST_MakePoint(%s, %s), 4326), 3857),
            ST_Transform(dg.centroid, 3857),
            %s
        )
        AND dg.centroid IS NOT NULL
        ORDER BY ST_Distance(
            ST_SetSRID(ST_MakePoint(%s, %s), 4326),
            dg.centroid
        )
        LIMIT %s
        """
        
        params = [lng, lat, lng, lat, radius_km * 1000, lng, lat, max_districts]
        cursor.execute(query, params)
        results = cursor.fetchall()
        
        districts = []
        for row in results:
            districts.append({
                "district_name": row[0],
                "state_name": row[1],
                "distance_km": float(row[2])
            })
        
        return districts
        
    except Exception as e:
        print(f"Error finding districts from coordinates: {e}")
        return []

def find_districts_within_radius_from_district(cursor, center_district, radius_km, max_districts):
    """Find districts within radius from a given district's centroid."""
    try:
        query = """
        SELECT 
            d2.district_name,
            ds2.state_name,
            CAST(ST_Distance(
                ST_Transform(d1.centroid, 3857),
                ST_Transform(d2.centroid, 3857)
            )/1000.0 AS NUMERIC(10,2)) as distance_km
        FROM District_Geometry d1
        CROSS JOIN District_Geometry d2
        JOIN District_State ds2 ON d2.district_name = ds2.district_name
        WHERE UPPER(TRIM(d1.district_name)) = %s
        AND d1.centroid IS NOT NULL
        AND d2.centroid IS NOT NULL
        AND ST_DWithin(
            ST_Transform(d1.centroid, 3857),
            ST_Transform(d2.centroid, 3857),
            %s
        )
        ORDER BY ST_Distance(d1.centroid, d2.centroid)
        LIMIT %s
        """
        
        cursor.execute(query, [normalize_district_name(center_district), radius_km * 1000, max_districts])
        results = cursor.fetchall()
        
        districts = []
        for row in results:
            districts.append({
                "district_name": row[0],
                "state_name": row[1],
                "distance_km": float(row[2])
            })
        
        return districts
        
    except Exception as e:
        print(f"Error finding districts from district: {e}")
        return []

def get_districts_multi_year_indicator_data(cursor, district_names, sdg_goal_number, indicator_names):
    """Get multi-year indicator data for districts with both 2016 and 2021 values plus AAC."""
    try:
        district_placeholders = ','.join(['%s'] * len(district_names))
        indicator_placeholders = ','.join(['%s'] * len(indicator_names))
        
        query = f"""
        SELECT 
            sgd.district_name,
            ds.state_name,
            sg.sdg_short_indicator_name,
            sg.sdg_full_indicator_name,
            sgd.nfhs_value_4 as value_2016,
            sgd.nfhs_value_5 as value_2021,
            sgd.actual_annual_change,
            COALESCE(sg.higher_is_better, FALSE) as higher_is_better,
            -- Calculate percentile ranking for 2021
            CASE 
                WHEN COALESCE(sg.higher_is_better, FALSE) = TRUE THEN 
                    PERCENT_RANK() OVER (PARTITION BY sg.sdg_short_indicator_name ORDER BY sgd.nfhs_value_5 DESC) * 100
                ELSE 
                    PERCENT_RANK() OVER (PARTITION BY sg.sdg_short_indicator_name ORDER BY sgd.nfhs_value_5 ASC) * 100
            END as performance_percentile_2021,
            -- Calculate percentile ranking for 2016
            CASE 
                WHEN COALESCE(sg.higher_is_better, FALSE) = TRUE THEN 
                    PERCENT_RANK() OVER (PARTITION BY sg.sdg_short_indicator_name ORDER BY sgd.nfhs_value_4 DESC) * 100
                ELSE 
                    PERCENT_RANK() OVER (PARTITION BY sg.sdg_short_indicator_name ORDER BY sgd.nfhs_value_4 ASC) * 100
            END as performance_percentile_2016
        FROM SDG_Goals_Data sgd
        JOIN SDG_Goals sg ON sgd.sdg_short_indicator_name = sg.sdg_short_indicator_name
        JOIN District_State ds ON sgd.district_name = ds.district_name
        WHERE sgd.district_name IN ({district_placeholders})
        AND sg.major_sdg_goal = %s
        AND sg.sdg_short_indicator_name IN ({indicator_placeholders})
        AND (sgd.nfhs_value_4 IS NOT NULL OR sgd.nfhs_value_5 IS NOT NULL)
        ORDER BY sgd.district_name, sg.sdg_short_indicator_name
        """
        
        params = district_names + [sdg_goal_number] + indicator_names
        cursor.execute(query, params)
        results = cursor.fetchall()
        
        # Group by district
        districts_data = {}
        for row in results:
            district_name = row[0]
            if district_name not in districts_data:
                districts_data[district_name] = {
                    "district_name": district_name,
                    "state_name": row[1],
                    "indicators": [],
                    "overall_performance_2021": 0,
                    "overall_performance_2016": 0
                }
            
            indicator_data = {
                "indicator_name": row[2],
                "indicator_full_name": row[3],
                "value_2016": float(row[4]) if row[4] is not None else None,
                "value_2021": float(row[5]) if row[5] is not None else None,
                "annual_change": float(row[6]) if row[6] is not None else None,
                "higher_is_better": row[7],
                "performance_percentile_2021": float(row[8]) if row[8] is not None else None,
                "performance_percentile_2016": float(row[9]) if row[9] is not None else None
            }
            
            districts_data[district_name]["indicators"].append(indicator_data)
        
        # Calculate overall performance for each district for both years
        for district_data in districts_data.values():
            if district_data["indicators"]:
                # 2021 performance
                percentiles_2021 = [
                    ind["performance_percentile_2021"] for ind in district_data["indicators"]
                    if ind["performance_percentile_2021"] is not None
                ]
                if percentiles_2021:
                    district_data["overall_performance_2021"] = float(np.mean(percentiles_2021))
                
                # 2016 performance
                percentiles_2016 = [
                    ind["performance_percentile_2016"] for ind in district_data["indicators"]
                    if ind["performance_percentile_2016"] is not None
                ]
                if percentiles_2016:
                    district_data["overall_performance_2016"] = float(np.mean(percentiles_2016))
                
                # Overall improvement
                if percentiles_2021 and percentiles_2016:
                    district_data["overall_improvement"] = district_data["overall_performance_2021"] - district_data["overall_performance_2016"]
        
        return list(districts_data.values())
        
    except Exception as e:
        print(f"Error getting districts multi-year indicator data: {e}")
        return []

def get_districts_multi_year_overall_data(cursor, district_names, sdg_goal_number):
    """Get multi-year overall SDG goal performance for districts."""
    try:
        district_placeholders = ','.join(['%s'] * len(district_names))
        
        query = f"""
        WITH district_rankings_2021 AS (
            SELECT 
                sgd.district_name,
                ds.state_name,
                CASE 
                    WHEN COALESCE(sg.higher_is_better, FALSE) = TRUE THEN 
                        PERCENT_RANK() OVER (PARTITION BY sg.sdg_short_indicator_name ORDER BY sgd.nfhs_value_5 DESC) * 100
                    ELSE 
                        PERCENT_RANK() OVER (PARTITION BY sg.sdg_short_indicator_name ORDER BY sgd.nfhs_value_5 ASC) * 100
                END as performance_percentile,
                sgd.actual_annual_change
            FROM SDG_Goals_Data sgd
            JOIN SDG_Goals sg ON sgd.sdg_short_indicator_name = sg.sdg_short_indicator_name
            JOIN District_State ds ON sgd.district_name = ds.district_name
            WHERE sgd.district_name IN ({district_placeholders})
            AND sg.major_sdg_goal = %s
            AND sgd.nfhs_value_5 IS NOT NULL
        ),
        district_rankings_2016 AS (
            SELECT 
                sgd.district_name,
                CASE 
                    WHEN COALESCE(sg.higher_is_better, FALSE) = TRUE THEN 
                        PERCENT_RANK() OVER (PARTITION BY sg.sdg_short_indicator_name ORDER BY sgd.nfhs_value_4 DESC) * 100
                    ELSE 
                        PERCENT_RANK() OVER (PARTITION BY sg.sdg_short_indicator_name ORDER BY sgd.nfhs_value_4 ASC) * 100
                END as performance_percentile
            FROM SDG_Goals_Data sgd
            JOIN SDG_Goals sg ON sgd.sdg_short_indicator_name = sg.sdg_short_indicator_name
            WHERE sgd.district_name IN ({district_placeholders})
            AND sg.major_sdg_goal = %s
            AND sgd.nfhs_value_4 IS NOT NULL
        )
        SELECT 
            r21.district_name,
            r21.state_name,
            AVG(r21.performance_percentile) as overall_performance_2021,
            AVG(r16.performance_percentile) as overall_performance_2016,
            AVG(r21.actual_annual_change) as avg_annual_change,
            COUNT(r21.performance_percentile) as indicator_count_2021,
            COUNT(r16.performance_percentile) as indicator_count_2016
        FROM district_rankings_2021 r21
        LEFT JOIN district_rankings_2016 r16 ON r21.district_name = r16.district_name
        GROUP BY r21.district_name, r21.state_name
        ORDER BY overall_performance_2021 DESC
        """
        
        params = district_names + [sdg_goal_number] + district_names + [sdg_goal_number]
        cursor.execute(query, params)
        results = cursor.fetchall()
        
        districts_data = []
        for row in results:
            district_data = {
                "district_name": row[0],
                "state_name": row[1],
                "overall_performance_2021": float(row[2]) if row[2] is not None else None,
                "overall_performance_2016": float(row[3]) if row[3] is not None else None,
                "avg_annual_change": float(row[4]) if row[4] is not None else None,
                "indicator_count_2021": int(row[5]),
                "indicator_count_2016": int(row[6])
            }
            
            # Calculate improvement
            if (district_data["overall_performance_2021"] is not None and 
                district_data["overall_performance_2016"] is not None):
                district_data["overall_improvement"] = (
                    district_data["overall_performance_2021"] - district_data["overall_performance_2016"]
                )
            
            districts_data.append(district_data)
        
        return districts_data
        
    except Exception as e:
        print(f"Error getting districts multi-year overall data: {e}")
        return []

def get_districts_multi_year_multi_goal_data(cursor, district_names):
    """Get multi-year multi-goal performance overview for districts."""
    try:
        district_placeholders = ','.join(['%s'] * len(district_names))
        
        query = f"""
        WITH district_goal_rankings_2021 AS (
            SELECT 
                sgd.district_name,
                ds.state_name,
                sg.major_sdg_goal,
                CASE 
                    WHEN COALESCE(sg.higher_is_better, FALSE) = TRUE THEN 
                        PERCENT_RANK() OVER (PARTITION BY sg.sdg_short_indicator_name ORDER BY sgd.nfhs_value_5 DESC) * 100
                    ELSE 
                        PERCENT_RANK() OVER (PARTITION BY sg.sdg_short_indicator_name ORDER BY sgd.nfhs_value_5 ASC) * 100
                END as performance_percentile
            FROM SDG_Goals_Data sgd
            JOIN SDG_Goals sg ON sgd.sdg_short_indicator_name = sg.sdg_short_indicator_name
            JOIN District_State ds ON sgd.district_name = ds.district_name
            WHERE sgd.district_name IN ({district_placeholders})
            AND sgd.nfhs_value_5 IS NOT NULL
        ),
        district_goal_rankings_2016 AS (
            SELECT 
                sgd.district_name,
                sg.major_sdg_goal,
                CASE 
                    WHEN COALESCE(sg.higher_is_better, FALSE) = TRUE THEN 
                        PERCENT_RANK() OVER (PARTITION BY sg.sdg_short_indicator_name ORDER BY sgd.nfhs_value_4 DESC) * 100
                    ELSE 
                        PERCENT_RANK() OVER (PARTITION BY sg.sdg_short_indicator_name ORDER BY sgd.nfhs_value_4 ASC) * 100
                END as performance_percentile
            FROM SDG_Goals_Data sgd
            JOIN SDG_Goals sg ON sgd.sdg_short_indicator_name = sg.sdg_short_indicator_name
            WHERE sgd.district_name IN ({district_placeholders})
            AND sgd.nfhs_value_4 IS NOT NULL
        )
        SELECT 
            r21.district_name,
            r21.state_name,
            r21.major_sdg_goal,
            AVG(r21.performance_percentile) as goal_performance_2021,
            AVG(r16.performance_percentile) as goal_performance_2016,
            COUNT(r21.performance_percentile) as indicator_count_2021,
            COUNT(r16.performance_percentile) as indicator_count_2016
        FROM district_goal_rankings_2021 r21
        LEFT JOIN district_goal_rankings_2016 r16 ON r21.district_name = r16.district_name 
                                                  AND r21.major_sdg_goal = r16.major_sdg_goal
        GROUP BY r21.district_name, r21.state_name, r21.major_sdg_goal
        ORDER BY r21.district_name, r21.major_sdg_goal
        """
        
        params = district_names + district_names
        cursor.execute(query, params)
        results = cursor.fetchall()
        
        # Group by district
        districts_data = {}
        for row in results:
            district_name = row[0]
            if district_name not in districts_data:
                districts_data[district_name] = {
                    "district_name": district_name,
                    "state_name": row[1],
                    "sdg_goals": [],
                    "overall_performance_2021": 0,
                    "overall_performance_2016": 0
                }
            
            goal_data = {
                "sdg_goal": int(row[2]),
                "performance_2021": float(row[3]) if row[3] is not None else None,
                "performance_2016": float(row[4]) if row[4] is not None else None,
                "indicator_count_2021": int(row[5]),
                "indicator_count_2016": int(row[6])
            }
            
            # Calculate improvement for this goal
            if (goal_data["performance_2021"] is not None and 
                goal_data["performance_2016"] is not None):
                goal_data["improvement"] = goal_data["performance_2021"] - goal_data["performance_2016"]
            
            districts_data[district_name]["sdg_goals"].append(goal_data)
        
        # Calculate overall performance for each district
        for district_data in districts_data.values():
            if district_data["sdg_goals"]:
                # 2021 overall performance
                performances_2021 = [
                    goal["performance_2021"] for goal in district_data["sdg_goals"]
                    if goal["performance_2021"] is not None
                ]
                if performances_2021:
                    district_data["overall_performance_2021"] = float(np.mean(performances_2021))
                
                # 2016 overall performance
                performances_2016 = [
                    goal["performance_2016"] for goal in district_data["sdg_goals"]
                    if goal["performance_2016"] is not None
                ]
                if performances_2016:
                    district_data["overall_performance_2016"] = float(np.mean(performances_2016))
                
                # Overall improvement
                if performances_2021 and performances_2016:
                    district_data["overall_improvement"] = (
                        district_data["overall_performance_2021"] - district_data["overall_performance_2016"]
                    )
        
        return list(districts_data.values())
        
    except Exception as e:
        print(f"Error getting districts multi-year multi-goal data: {e}")
        return []

def generate_radius_analysis(center_name, center_type, radius_km, districts_data, sdg_goal_number, indicator_names):
    """Generate comprehensive analysis for districts within radius."""
    try:
        if not districts_data:
            return "No districts found within the specified radius."
        
        analysis = f"# Districts Within {radius_km} km Radius Analysis\n\n"
        
        # Center point info
        if center_type == "district":
            analysis += f"**Center Point:** {center_name} (District)\n"
        else:
            analysis += f"**Center Point:** {center_name} (Coordinates)\n"
        
        analysis += f"**Radius:** {radius_km} km\n"
        analysis += f"**Districts Found:** {len(districts_data)}\n\n"
        
        # Performance overview
        if sdg_goal_number and indicator_names:
            analysis += f"## SDG {sdg_goal_number} - Specific Indicators Analysis\n\n"
            analysis += f"**Indicators:** {', '.join(indicator_names)}\n\n"
            
            # Top and bottom performers for 2021
            districts_with_2021 = [d for d in districts_data if d.get("overall_performance_2021") is not None]
            if districts_with_2021:
                top_2021 = sorted(districts_with_2021, key=lambda x: x["overall_performance_2021"], reverse=True)[:3]
                bottom_2021 = sorted(districts_with_2021, key=lambda x: x["overall_performance_2021"])[:3]
                
                analysis += "### Top Performers (2021):\n"
                for i, district in enumerate(top_2021, 1):
                    analysis += f"{i}. **{district['district_name']}, {district['state_name']}** - "
                    analysis += f"Performance: {district['overall_performance_2021']:.1f}th percentile"
                    if district.get("distance_km"):
                        analysis += f" (Distance: {district['distance_km']:.1f} km)"
                    analysis += "\n"
                
                analysis += "\n### Bottom Performers (2021):\n"
                for i, district in enumerate(bottom_2021, 1):
                    analysis += f"{i}. **{district['district_name']}, {district['state_name']}** - "
                    analysis += f"Performance: {district['overall_performance_2021']:.1f}th percentile"
                    if district.get("distance_km"):
                        analysis += f" (Distance: {district['distance_km']:.1f} km)"
                    analysis += "\n"
            
            # Improvement analysis
            districts_with_improvement = [d for d in districts_data if d.get("overall_improvement") is not None]
            if districts_with_improvement:
                improved = sorted(districts_with_improvement, key=lambda x: x["overall_improvement"], reverse=True)[:3]
                declined = sorted(districts_with_improvement, key=lambda x: x["overall_improvement"])[:3]
                
                analysis += "\n### Most Improved (2016-2021):\n"
                for i, district in enumerate(improved, 1):
                    improvement = district['overall_improvement']
                    analysis += f"{i}. **{district['district_name']}, {district['state_name']}** - "
                    analysis += f"Improvement: +{improvement:.1f} percentile points"
                    if district.get("distance_km"):
                        analysis += f" (Distance: {district['distance_km']:.1f} km)"
                    analysis += "\n"
                
                analysis += "\n### Most Declined (2016-2021):\n"
                for i, district in enumerate(declined, 1):
                    decline = district['overall_improvement']
                    analysis += f"{i}. **{district['district_name']}, {district['state_name']}** - "
                    analysis += f"Change: {decline:.1f} percentile points"
                    if district.get("distance_km"):
                        analysis += f" (Distance: {district['distance_km']:.1f} km)"
                    analysis += "\n"
        
        elif sdg_goal_number:
            analysis += f"## SDG {sdg_goal_number} Overall Performance Analysis\n\n"
            
            # Similar analysis for overall SDG performance
            districts_with_2021 = [d for d in districts_data if d.get("overall_performance_2021") is not None]
            if districts_with_2021:
                top_2021 = sorted(districts_with_2021, key=lambda x: x["overall_performance_2021"], reverse=True)[:5]
                analysis += "### Top Performing Districts (2021):\n"
                for i, district in enumerate(top_2021, 1):
                    analysis += f"{i}. **{district['district_name']}, {district['state_name']}** - "
                    analysis += f"{district['overall_performance_2021']:.1f}th percentile"
                    if district.get("distance_km"):
                        analysis += f" ({district['distance_km']:.1f} km from center)"
                    analysis += "\n"
        
        else:
            analysis += "## Multi-Goal SDG Performance Overview\n\n"
            
            # Multi-goal analysis
            districts_with_2021 = [d for d in districts_data if d.get("overall_performance_2021") is not None]
            if districts_with_2021:
                top_overall = sorted(districts_with_2021, key=lambda x: x["overall_performance_2021"], reverse=True)[:5]
                analysis += "### Top Overall Performers (2021):\n"
                for i, district in enumerate(top_overall, 1):
                    analysis += f"{i}. **{district['district_name']}, {district['state_name']}** - "
                    analysis += f"{district['overall_performance_2021']:.1f}th percentile"
                    if district.get("distance_km"):
                        analysis += f" ({district['distance_km']:.1f} km from center)"
                    analysis += "\n"
        
        # Geographic distribution
        analysis += "\n## Geographic Distribution\n\n"
        state_counts = {}
        for district in districts_data:
            state = district.get("state_name", "Unknown")
            state_counts[state] = state_counts.get(state, 0) + 1
        
        analysis += "**Districts by State:**\n"
        for state, count in sorted(state_counts.items(), key=lambda x: x[1], reverse=True):
            analysis += f"- {state}: {count} districts\n"
        
        # Distance distribution
        distances = [d.get("distance_km", 0) for d in districts_data if d.get("distance_km") is not None]
        if distances:
            analysis += f"\n**Distance Range:** {min(distances):.1f} - {max(distances):.1f} km\n"
            analysis += f"**Average Distance:** {np.mean(distances):.1f} km\n"
        
        return analysis
        
    except Exception as e:
        return f"Error generating radius analysis: {str(e)}"