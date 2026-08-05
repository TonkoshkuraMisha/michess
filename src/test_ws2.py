import asyncio
import websockets
import json

# Токен для Player 3
TOKEN = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJwbGF5ZXIzIiwiZXhwIjoxNzg1OTI0MTU3fQ.BuiwOMYF9at20XnfYyc4_5QPsNid8EOPPMl_QQM6rcM"
URL = f"ws://127.0.0.1:8000/api/v1/ws/matchmaking?token={TOKEN}"


async def test_websocket():
    try:
        async with websockets.connect(URL) as ws:
            print("Connected to server!")

            welcome_msg = await ws.recv()
            print(f"Received: {welcome_msg}")

            print("Requesting seeks list...")
            await ws.send(json.dumps({"action": "get_seeks"}))

            game_id = None

            while True:
                msg = await ws.recv()
                print(f"Server says: {msg}")
                data = json.loads(msg)

                if data.get("event") == "seeks_list":
                    seeks = data.get("seeks", [])
                    if seeks:
                        opponent = seeks[0]
                        print(f"Found seek from {opponent['username']}. Accepting...")
                        await ws.send(json.dumps({
                            "action": "accept_seek",
                            "opponent_id": opponent["user_id"],
                            "base_time_ms": opponent["base_time_ms"],
                            "increment_ms": opponent["increment_ms"]
                        }))
                    else:
                        await asyncio.sleep(2)
                        await ws.send(json.dumps({"action": "get_seeks"}))

                elif data.get("event") == "match_found":
                    game_id = data["game_id"]

                elif data.get("event") == "move_made":
                    if data.get("player_id") != 3:
                        print("Opponent moved. Sending move e7e5...")
                        await asyncio.sleep(1)
                        await ws.send(json.dumps({
                            "action": "make_move",
                            "game_id": game_id,
                            "move": "e7e5",
                            "time_taken_ms": 1000,
                            "window_blurred": False
                        }))

                elif data.get("event") == "draw_offered":
                    print("Draw offered by opponent. Accepting draw...")
                    await asyncio.sleep(1)
                    await ws.send(json.dumps({
                        "action": "accept_draw",
                        "game_id": game_id
                    }))

                elif data.get("event") == "game_over":
                    print(f"Game over received: {data}")
                    break

    except websockets.exceptions.ConnectionClosed:
        print("Connection closed.")
    except Exception as e:
        print(f"An error occurred: {e}")


if __name__ == "__main__":
    asyncio.run(test_websocket())