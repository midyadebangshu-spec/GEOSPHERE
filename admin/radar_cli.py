import redis
import sys
import os

R_HOST = os.getenv('REDIS_HOST', '127.0.0.1')
R_PORT = int(os.getenv('REDIS_PORT', 6379))

# Attempt connection
try:
    client = redis.StrictRedis(host=R_HOST, port=R_PORT, decode_responses=True)
    client.ping()
except redis.ConnectionError:
    print(f"[!] Unable to connect to Redis at {R_HOST}:{R_PORT}")
    sys.exit(1)

def print_menu():
    print("\n" + "="*50)
    print("  GeoSphere WB+ Radar | Admin Configuration Tool")
    print("="*50)
    print("1. View Current Configuration")
    print("2. Set Distance Filter (Meters)")
    print("3. Set Search Radius (KM)")
    print("4. Set Max Users Returned")
    print("5. Set Refresh Interval (ms)")
    print("6. Exit\n")

def get_current_config():
    config = client.hgetall('app_config')
    # Default fallbacks if empty
    return {
        'distance_filter_meters': config.get('distance_filter_meters', 5),
        'search_radius_km': config.get('search_radius_km', 2),
        'max_users_returned': config.get('max_users_returned', 50),
        'refresh_interval_ms': config.get('refresh_interval_ms', 5000)
    }

def update_config(field, prompt, cast_type):
    current = get_current_config()[field]
    print(f"\nCurrent {field}: {current}")
    val = input(f"Enter new {prompt} (or press Enter to cancel): ").strip()
    
    if not val:
        return
        
    try:
        val = cast_type(val)
        client.hset('app_config', field, val)
        client.publish('admin_alerts', 'config_updated')
        print(f"[+] Successfully updated {field} to {val} and broadcasted to Node.js servers.")
    except Exception as e:
        print(f"[!] Error updating field: {e}")

def main():
    while True:
        print_menu()
        choice = input("Select an option (1-6): ").strip()
        
        if choice == '1':
            conf = get_current_config()
            print("\n--- Current Configuration ---")
            for k, v in conf.items():
                print(f"{k}: {v}")
        elif choice == '2':
            update_config('distance_filter_meters', 'Distance Filter in Meters (e.g. 10.5)', float)
        elif choice == '3':
            update_config('search_radius_km', 'Search Radius in KM (e.g. 5.0)', float)
        elif choice == '4':
            update_config('max_users_returned', 'Max Users (e.g. 100)', int)
        elif choice == '5':
            update_config('refresh_interval_ms', 'Refresh Interval in ms (e.g. 3000)', int)
        elif choice == '6':
            print("Exiting...")
            sys.exit(0)
        else:
            print("Invalid option. Please try again.")

if __name__ == "__main__":
    main()
