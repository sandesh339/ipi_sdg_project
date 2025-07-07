#!/usr/bin/env python3
"""
Startup script for SDG Chatbot Server
"""
import uvicorn
from config import API_HOST, API_PORT, API_RELOAD
import sys

def main():
    """Start the SDG Chatbot server"""
    try:
        print("🚀 Starting SDG Chatbot Server...")
        print(f"📡 Server will be available at: http://{API_HOST}:{API_PORT}")
        print(f"📚 API Documentation: http://{API_HOST}:{API_PORT}/docs")
        print(f"🔄 Reload mode: {'Enabled' if API_RELOAD else 'Disabled'}")
        print("=" * 60)
        
        uvicorn.run(
            "sdg_main:app",
            host=API_HOST,
            port=API_PORT,
            reload=API_RELOAD,
            log_level="info"
        )
    except KeyboardInterrupt:
        print("\n👋 Server stopped by user")
    except Exception as e:
        print(f"❌ Error starting server: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main() 