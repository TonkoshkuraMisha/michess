import asyncio
import websockets
import json

# Токен для Player 1
TOKEN = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJwbGF5ZXIxIiwiZXhwIjoxNzg1OTY5MjQwfQ.NHjXmbJAmHcd_WhRE2ni0EhVYefuPb2HX925cRQMgX8"
URL = f"ws://127.0.0.1:8000/api/v1/ws/matchmaking?token={TOKEN}"


async def test_websocket():
    try:
        async with websockets.connect(URL) as ws:
            print("Connected to server!")

            welcome_msg = await ws.recv()
            print(f"Received: {welcome_msg}")

            print("Joining matchmaking queue for 3+0...")
            await ws.send(json.dumps({
                "action": "join_queue",
                "base_time_ms": 180000,
                "increment_ms": 0
            }))

            while True:
                msg = await ws.recv()
                print(f"Server says: {msg}")
                data = json.loads(msg)

                if data.get("event") == "match_found" and data.get("color") == "white":
                    print("Match started! Sending move e2e4...")
                    await asyncio.sleep(1)
                    await ws.send(json.dumps({
                        "action": "make_move",
                        "game_id": data["game_id"],
                        "move": "e2e4",
                        "time_taken_ms": 1000,
                        "window_blurred": False
                    }))

                    # Предлагаем ничью после хода
                    await asyncio.sleep(1)
                    print("Offering draw...")
                    await ws.send(json.dumps({
                        "action": "offer_draw",
                        "game_id": data["game_id"]
                    }))

                elif data.get("event") == "draw_declined":
                    print("Draw was declined by opponent.")

                elif data.get("event") == "game_over":
                    print(f"Game over received: {data}")
                    break

    except websockets.exceptions.ConnectionClosed:
        print("Connection closed.")
    except Exception as e:
        print(f"An error occurred: {e}")


if __name__ == "__main__":
    asyncio.run(test_websocket())