import asyncio
import websockets
import json

# Вставьте сюда ваш токен для Player 1
TOKEN = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJwbGF5ZXIxIiwiZXhwIjoxNzg1OTIxOTU3fQ.J_uTcuCmATJCR6aNqSnoCyAZom5jVOjZoFwIkIpRbCs"
URL = f"ws://127.0.0.1:8000/api/v1/ws/matchmaking?token={TOKEN}"


async def test_websocket():
    try:
        async with websockets.connect(URL) as ws:
            print("Connected to server!")

            welcome_msg = await ws.recv()
            print(f"Received: {welcome_msg}")

            # 1. Создаем открытый вызов (3 минуты, 0 секунд добавка)
            print("Creating seek for 3+0 (180000ms)...")
            await ws.send(json.dumps({
                "action": "create_seek",
                "base_time_ms": 180000,
                "increment_ms": 0
            }))

            while True:
                msg = await ws.recv()
                print(f"Server says: {msg}")
                data = json.loads(msg)

                # 2. Если вызов принят и матч начался, ходим e2e4
                if data.get("event") == "match_found" and data.get("color") == "white":
                    print("Match started! Sending move e2e4...")
                    await asyncio.sleep(1)  # Имитация времени на раздумье
                    await ws.send(json.dumps({
                        "action": "make_move",
                        "game_id": data["game_id"],
                        "move": "e2e4",
                        "time_taken_ms": 1000,
                        "window_blurred": False
                    }))

    except websockets.exceptions.ConnectionClosed:
        print("Connection closed.")
    except Exception as e:
        print(f"An error occurred: {e}")


if __name__ == "__main__":
    asyncio.run(test_websocket())