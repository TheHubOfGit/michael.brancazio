#!/usr/bin/env python3
"""
Script to log Gemini AI questions and automatically commit to Git
Usage: python log_gemini_question.py "Your question here" "topic" "response_summary"
"""

import json
import sys
import subprocess
from datetime import datetime
import os

def log_to_json(question, topic="general", response_summary=""):
    """Log question to JSON file"""
    log_file = "gemini_chat_log.json"
    
    # Load existing log or create new
    if os.path.exists(log_file):
        with open(log_file, 'r') as f:
            data = json.load(f)
    else:
        data = {
            "log_info": {
                "created": datetime.now().strftime("%Y-%m-%d"),
                "description": "Log of all Gemini AI chatbot interactions",
                "version": "1.0"
            },
            "interactions": []
        }
    
    # Add new interaction
    new_interaction = {
        "timestamp": datetime.now().isoformat(),
        "question": question,
        "response_summary": response_summary,
        "topic": topic,
        "session_id": f"session_{len(data['interactions']) + 1:03d}"
    }
    
    data['interactions'].append(new_interaction)
    
    # Save updated log
    with open(log_file, 'w') as f:
        json.dump(data, f, indent=2)
    
    return new_interaction

def log_to_markdown(question, topic="general", response_summary=""):
    """Log question to Markdown file"""
    log_file = "GEMINI_CHAT_LOG.md"
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M")
    
    entry = f"""
### Session - {timestamp}
**Question:** {question}
**Topic:** {topic}
**Response Summary:** {response_summary}
**Useful:** ⏳ Pending Review

---
"""
    
    # Append to markdown file
    with open(log_file, 'a') as f:
        f.write(entry)

def git_commit_and_push():
    """Automatically commit and push the log files"""
    try:
        subprocess.run(['git', 'add', 'gemini_chat_log.json', 'GEMINI_CHAT_LOG.md'], check=True)
        commit_msg = f"Auto-log: Gemini question at {datetime.now().strftime('%Y-%m-%d %H:%M')}"
        subprocess.run(['git', 'commit', '-m', commit_msg], check=True)
        subprocess.run(['git', 'push'], check=True)
        print("✅ Successfully logged and pushed to Git!")
    except subprocess.CalledProcessError as e:
        print(f"❌ Git operation failed: {e}")

def main():
    if len(sys.argv) < 2:
        print("Usage: python log_gemini_question.py 'Your question' [topic] [response_summary]")
        sys.exit(1)
    
    question = sys.argv[1]
    topic = sys.argv[2] if len(sys.argv) > 2 else "general"
    response_summary = sys.argv[3] if len(sys.argv) > 3 else ""
    
    # Log to both formats
    interaction = log_to_json(question, topic, response_summary)
    log_to_markdown(question, topic, response_summary)
    
    print(f"📝 Logged question: {question[:50]}...")
    print(f"🏷️  Topic: {topic}")
    
    # Auto-commit and push
    if input("Push to Git? (y/N): ").lower() == 'y':
        git_commit_and_push()

if __name__ == "__main__":
    main() 