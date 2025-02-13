import axios from "axios"
import { getBookingByStatus, changeBookingStatus } from "../database.js"

const API = "http://84.252.135.231/api"


const  updateToken  = async(): Promise<string> => {
    const email = process.env.API_EMAIL
    const password = process.env.API_PASSWORD

    return await axios.post(`${API}/auth/login`,
        { email, password }
    ).then((response) => {
        httpInstance.defaults.headers.common["Authorization"] = response.data.token
        return response.data.token
    }).catch((error) => {
        throw error.status == 400 
            ? new Error(`Invalid user email: ${email}`)
            : new Error(error)
    })
}
const httpInstance = axios.create({
    headers: {
        common: {
            Authorization: "Bearer " + process.env.API_TOKEN,
        },
    },
})


httpInstance.interceptors.response.use((response) => response, async (error) => {
    if(error.response && error.status == 429) {
        return httpInstance(error.config)
    }
    if (error.response && error.status == 403) {
        try {
            const token = await updateToken()
            error.config.headers["Authorization"] = `Bearer ${token}`
            return httpInstance(error.config)
        } catch (error) {
            return Promise.reject(error)
        }
    }
    return Promise.reject(error)
})

export const getWagons = async (trainId: number): Promise<Wagon[] | null> => {
    return await httpInstance.get(`${API}/info/wagons?trainId=${trainId}`).then((response) => {
        return response.data
    }).catch((_) => {
        return null
    })
}

export const getWagon = async (wagonId: number): Promise<Wagon | null> => {
    return await httpInstance.get(`${API}/info/wagons/${wagonId}`).then((response) => {
        return response.data
    }).catch((_) => {
        return null
    })
}

export const getTrains = async (booking_available: boolean = true, start_point: string = "%.*%", end_point: string = "%.*%", stop_points: string = ""): Promise<Train[]>  => {
    return await httpInstance.get(`${API}/info/trains?booking_available=${booking_available}&start_point=${start_point}&end_point=${end_point}&stop_points=${stop_points}`).then((response) => {
        return response.data
    }).catch((error) => {
        throw error.status == 400 
            ? new Error("Invalid filter data.")
            : new Error(error)
    })
}

export const getTrain = async (trainId: number): Promise<Train | null> => {
    return await httpInstance.get(`${API}/info/train/${trainId}`).then((response) => {
        return response.data
    }).catch((_) => {
        return null
    })
}

export const getSeats = async (wagonId: number): Promise<Seat[] | null> => {
    return await httpInstance.get(`${API}/info/seats?wagonId=${wagonId}`).then((response) => {
        return response.data
    }).catch((_) => {
        return null
    })
}

export const getSeat = async (seatId: number): Promise<Seat | null> => {
    return await httpInstance.get(`${API}/info/seat/${seatId}`).then((response) => {
        return response.data
    }).catch((_) => {
        return null
    })
}

export const order = async (train_id: number, wagon_id: number, seat_ids: number[]): Promise<Order | null> => {
    return await httpInstance.post(`${API}/order`,
        {train_id, wagon_id, seat_ids}
    ).then((response) => {
        return response.data
    }).catch((error) => {
        throw new Error(error)
    })
}

export const bookingCheck = async () => {
    const booking = await getBookingByStatus(true);
    if (!booking) return;

    const trainCache: { [key: string]: any } = {};
    const seatCache: { [key: string]: any } = {};

    const getTrainsCached = async(active: boolean, startPoint: string, endPoint: string) => {
        const key = `${active}-${startPoint}-${endPoint}`;
        if (trainCache[key]) return trainCache[key];
        const trains = await getTrains(active, startPoint, endPoint);
        trainCache[key] = trains;
        return trains;
    }

    const getSeatsCached = async(wagonId: number) => {
        if (seatCache[wagonId]) return seatCache[wagonId];
        const seats = await getSeats(wagonId);
        seatCache[wagonId] = seats;
        return seats;
    }

    let isBookingProcessed = false;

    for (const book of booking) {
        if (isBookingProcessed) break;
        if (!book.isActive) break;

        try {
            const trains = await getTrainsCached(true, book.startPoint, book.endPoint);
            if (!trains) continue;
            
            for (const train of trains) {
                if (book.availableSeatsCount <= train.available_seats_count && book.startpointDeparture === train.startpoint_departure.split(' ')[0]){
                    
                    for (const wagon of train.wagons_info) {
                        
                        if (wagon.type === book.wagonType) {
                            
                            const seats = await getSeatsCached(wagon.wagon_id);
                            if (!seats) continue;
                                
                            let freeSeats = 0;
                            for (const seat of seats) {
                                if (seat.bookingStatus === "FREE") {
                                    freeSeats++;
                                }
                            }
                            

                            if (freeSeats < book.availableSeatsCount) continue;
                            
                            let seatCount = 0;
                            let seatForBooking: number[] = [];
                            for (const seat of seats) {
                                if (seat.bookingStatus === "FREE" && seatCount < book.availableSeatsCount) {
                                    seatForBooking.push(seat.seat_id);
                                    seatCount++;
                                }
                            }

                            if (seatForBooking.length >= book.availableSeatsCount) {
                                if (book.isAuto) {
                                    const order1 = await order(train.train_id, wagon.wagon_id, seatForBooking);
                                    console.log(order1);
                                }
                                await changeBookingStatus(book.id);
                                isBookingProcessed = true;
                                break;
                            }
                        }
                        if (isBookingProcessed) break;
                    }
                    if (isBookingProcessed) break;
                }
            }
            if (isBookingProcessed) break;
        } catch (error) {
            console.error("Error processing booking:", error);
        }
    }
}

export type Order = {
    order_id: number
    status: "Success" | "Failure"
}

export type Train = {
    tratrin_id: number
    global_route: string
    startpoint_departure: string
    endpoint_arrival: string
    detailed_route: Route[]
    wagons_info: Wagon[]
    available_seats_count: number
}

export type Route = {
    name: string
    num: number
    arrival: string
    departure: string
}

export type Wagon =  {
    wagon_id: number,
    type: "LOCAL" | "PLATZCART" | "COUPE" | "SV" | "LUX"
    seats?: Seat[]
}

export type Seat = {
    seat_id: number,
    seatNum: string,
    block: string,
    price: number,
    bookingStatus: "CLOSED" | "FREE" | "BOOKED"
}