// Each country has an array of {name, lat, lon} points.
// The FIRST entry is always the capital (used for "capitals" set).
// Additional entries are major cities (used for "bigcities" / general random sets).
export const GEO_POINTS = {
  "United States of America": [
    { name: "Washington, D.C.", lat: 38.9, lon: -77.04 },
    { name: "New York", lat: 40.71, lon: -74.01 },
    { name: "Los Angeles", lat: 34.05, lon: -118.24 },
    { name: "Chicago", lat: 41.88, lon: -87.63 },
    { name: "Houston", lat: 29.76, lon: -95.37 },
    { name: "Phoenix", lat: 33.45, lon: -112.07 },
    { name: "San Francisco", lat: 37.77, lon: -122.42 },
    { name: "Seattle", lat: 47.61, lon: -122.33 },
    { name: "Miami", lat: 25.77, lon: -80.19 },
    { name: "Las Vegas", lat: 36.17, lon: -115.14 },
  ],
  "Canada": [
    { name: "Ottawa", lat: 45.41, lon: -75.7 },
    { name: "Toronto", lat: 43.65, lon: -79.38 },
    { name: "Vancouver", lat: 49.28, lon: -123.12 },
    { name: "Montreal", lat: 45.5, lon: -73.57 },
    { name: "Calgary", lat: 51.05, lon: -114.07 },
  ],
  "Mexico": [
    { name: "Mexico City", lat: 19.43, lon: -99.13 },
    { name: "Guadalajara", lat: 20.66, lon: -103.35 },
    { name: "Monterrey", lat: 25.67, lon: -100.31 },
    { name: "Cancún", lat: 21.16, lon: -86.85 },
  ],
  "Brazil": [
    { name: "Brasília", lat: -15.78, lon: -47.93 },
    { name: "São Paulo", lat: -23.55, lon: -46.63 },
    { name: "Rio de Janeiro", lat: -22.91, lon: -43.17 },
    { name: "Salvador", lat: -12.97, lon: -38.5 },
    { name: "Fortaleza", lat: -3.72, lon: -38.54 },
  ],
  "Argentina": [
    { name: "Buenos Aires", lat: -34.61, lon: -58.38 },
    { name: "Córdoba", lat: -31.42, lon: -64.19 },
    { name: "Mendoza", lat: -32.89, lon: -68.83 },
    { name: "Rosario", lat: -32.95, lon: -60.65 },
  ],
  "Chile": [
    { name: "Santiago", lat: -33.46, lon: -70.65 },
    { name: "Valparaíso", lat: -33.04, lon: -71.62 },
    { name: "Concepción", lat: -36.82, lon: -73.05 },
  ],
  "Colombia": [
    { name: "Bogotá", lat: 4.61, lon: -74.08 },
    { name: "Medellín", lat: 6.25, lon: -75.57 },
    { name: "Cali", lat: 3.43, lon: -76.52 },
    { name: "Cartagena", lat: 10.39, lon: -75.48 },
  ],
  "Peru": [
    { name: "Lima", lat: -12.04, lon: -77.03 },
    { name: "Cusco", lat: -13.53, lon: -71.97 },
    { name: "Arequipa", lat: -16.41, lon: -71.54 },
  ],
  "Venezuela": [
    { name: "Caracas", lat: 10.48, lon: -66.88 },
    { name: "Maracaibo", lat: 10.65, lon: -71.65 },
  ],
  "Bolivia": [
    { name: "Sucre", lat: -19.03, lon: -65.26 },
    { name: "La Paz", lat: -16.5, lon: -68.15 },
  ],
  "Ecuador": [
    { name: "Quito", lat: -0.22, lon: -78.51 },
    { name: "Guayaquil", lat: -2.17, lon: -79.92 },
  ],
  "Uruguay": [
    { name: "Montevideo", lat: -34.9, lon: -56.19 },
  ],
  "Paraguay": [
    { name: "Asunción", lat: -25.29, lon: -57.65 },
  ],
  "United Kingdom": [
    { name: "London", lat: 51.51, lon: -0.13 },
    { name: "Manchester", lat: 53.48, lon: -2.24 },
    { name: "Birmingham", lat: 52.48, lon: -1.9 },
    { name: "Edinburgh", lat: 55.95, lon: -3.19 },
    { name: "Glasgow", lat: 55.86, lon: -4.25 },
    { name: "Bristol", lat: 51.45, lon: -2.59 },
    { name: "Liverpool", lat: 53.41, lon: -2.98 },
  ],
  "France": [
    { name: "Paris", lat: 48.85, lon: 2.35 },
    { name: "Lyon", lat: 45.76, lon: 4.84 },
    { name: "Marseille", lat: 43.3, lon: 5.37 },
    { name: "Nice", lat: 43.71, lon: 7.26 },
    { name: "Bordeaux", lat: 44.84, lon: -0.58 },
    { name: "Strasbourg", lat: 48.58, lon: 7.75 },
  ],
  "Germany": [
    { name: "Berlin", lat: 52.52, lon: 13.41 },
    { name: "Munich", lat: 48.14, lon: 11.58 },
    { name: "Hamburg", lat: 53.55, lon: 10.0 },
    { name: "Cologne", lat: 50.94, lon: 6.96 },
    { name: "Frankfurt", lat: 50.11, lon: 8.68 },
    { name: "Stuttgart", lat: 48.78, lon: 9.18 },
    { name: "Dresden", lat: 51.05, lon: 13.74 },
  ],
  "Spain": [
    { name: "Madrid", lat: 40.42, lon: -3.7 },
    { name: "Barcelona", lat: 41.39, lon: 2.16 },
    { name: "Seville", lat: 37.39, lon: -5.99 },
    { name: "Valencia", lat: 39.47, lon: -0.38 },
    { name: "Bilbao", lat: 43.26, lon: -2.93 },
    { name: "Málaga", lat: 36.72, lon: -4.42 },
  ],
  "Italy": [
    { name: "Rome", lat: 41.89, lon: 12.51 },
    { name: "Milan", lat: 45.46, lon: 9.19 },
    { name: "Naples", lat: 40.85, lon: 14.27 },
    { name: "Florence", lat: 43.77, lon: 11.25 },
    { name: "Venice", lat: 45.44, lon: 12.33 },
    { name: "Turin", lat: 45.07, lon: 7.69 },
    { name: "Bologna", lat: 44.49, lon: 11.34 },
  ],
  "Netherlands": [
    { name: "Amsterdam", lat: 52.37, lon: 4.89 },
    { name: "Rotterdam", lat: 51.92, lon: 4.48 },
    { name: "The Hague", lat: 52.08, lon: 4.31 },
    { name: "Utrecht", lat: 52.09, lon: 5.12 },
    { name: "Eindhoven", lat: 51.44, lon: 5.48 },
    { name: "Groningen", lat: 53.22, lon: 6.57 },
    { name: "Maastricht", lat: 50.85, lon: 5.69 },
    { name: "Leiden", lat: 52.16, lon: 4.49 },
    { name: "Haarlem", lat: 52.38, lon: 4.64 },
    { name: "Delft", lat: 52.01, lon: 4.36 },
    { name: "Nijmegen", lat: 51.84, lon: 5.87 },
    { name: "Arnhem", lat: 51.98, lon: 5.91 },
    { name: "Tilburg", lat: 51.56, lon: 5.09 },
    { name: "Breda", lat: 51.59, lon: 4.78 },
  ],
  "Belgium": [
    { name: "Brussels", lat: 50.85, lon: 4.35 },
    { name: "Antwerp", lat: 51.22, lon: 4.4 },
    { name: "Ghent", lat: 51.05, lon: 3.72 },
    { name: "Bruges", lat: 51.21, lon: 3.22 },
    { name: "Liège", lat: 50.63, lon: 5.57 },
  ],
  "Switzerland": [
    { name: "Bern", lat: 46.95, lon: 7.45 },
    { name: "Zurich", lat: 47.38, lon: 8.54 },
    { name: "Geneva", lat: 46.2, lon: 6.15 },
    { name: "Basel", lat: 47.56, lon: 7.59 },
    { name: "Lausanne", lat: 46.52, lon: 6.63 },
    { name: "Lucerne", lat: 47.05, lon: 8.31 },
  ],
  "Austria": [
    { name: "Vienna", lat: 48.21, lon: 16.37 },
    { name: "Salzburg", lat: 47.8, lon: 13.04 },
    { name: "Graz", lat: 47.07, lon: 15.44 },
    { name: "Innsbruck", lat: 47.27, lon: 11.4 },
  ],
  "Portugal": [
    { name: "Lisbon", lat: 38.72, lon: -9.13 },
    { name: "Porto", lat: 41.15, lon: -8.61 },
    { name: "Faro", lat: 37.02, lon: -7.93 },
  ],
  "Poland": [
    { name: "Warsaw", lat: 52.23, lon: 21.01 },
    { name: "Kraków", lat: 50.06, lon: 19.94 },
    { name: "Wrocław", lat: 51.11, lon: 17.04 },
    { name: "Gdańsk", lat: 54.35, lon: 18.65 },
    { name: "Poznań", lat: 52.41, lon: 16.93 },
  ],
  "Czech Republic": [
    { name: "Prague", lat: 50.09, lon: 14.42 },
    { name: "Brno", lat: 49.2, lon: 16.61 },
    { name: "Ostrava", lat: 49.83, lon: 18.29 },
  ],
  "Sweden": [
    { name: "Stockholm", lat: 59.33, lon: 18.07 },
    { name: "Gothenburg", lat: 57.71, lon: 11.97 },
    { name: "Malmö", lat: 55.61, lon: 13.0 },
    { name: "Uppsala", lat: 59.86, lon: 17.64 },
  ],
  "Norway": [
    { name: "Oslo", lat: 59.91, lon: 10.75 },
    { name: "Bergen", lat: 60.39, lon: 5.33 },
    { name: "Trondheim", lat: 63.43, lon: 10.39 },
  ],
  "Denmark": [
    { name: "Copenhagen", lat: 55.68, lon: 12.57 },
    { name: "Aarhus", lat: 56.16, lon: 10.21 },
    { name: "Odense", lat: 55.4, lon: 10.38 },
  ],
  "Finland": [
    { name: "Helsinki", lat: 60.17, lon: 24.94 },
    { name: "Tampere", lat: 61.5, lon: 23.77 },
    { name: "Turku", lat: 60.45, lon: 22.27 },
  ],
  "Ireland": [
    { name: "Dublin", lat: 53.33, lon: -6.25 },
    { name: "Cork", lat: 51.9, lon: -8.47 },
    { name: "Galway", lat: 53.27, lon: -9.06 },
  ],
  "Greece": [
    { name: "Athens", lat: 37.98, lon: 23.73 },
    { name: "Thessaloniki", lat: 40.64, lon: 22.94 },
    { name: "Heraklion", lat: 35.34, lon: 25.14 },
  ],
  "Hungary": [
    { name: "Budapest", lat: 47.5, lon: 19.04 },
    { name: "Debrecen", lat: 47.53, lon: 21.63 },
    { name: "Pécs", lat: 46.08, lon: 18.23 },
  ],
  "Romania": [
    { name: "Bucharest", lat: 44.43, lon: 26.11 },
    { name: "Cluj-Napoca", lat: 46.77, lon: 23.59 },
    { name: "Timișoara", lat: 45.75, lon: 21.23 },
  ],
  "Ukraine": [
    { name: "Kyiv", lat: 50.45, lon: 30.52 },
    { name: "Lviv", lat: 49.84, lon: 24.03 },
    { name: "Odesa", lat: 46.48, lon: 30.72 },
  ],
  "Russia": [
    { name: "Moscow", lat: 55.75, lon: 37.62 },
    { name: "Saint Petersburg", lat: 59.95, lon: 30.32 },
    { name: "Novosibirsk", lat: 54.99, lon: 82.9 },
    { name: "Yekaterinburg", lat: 56.84, lon: 60.6 },
    { name: "Vladivostok", lat: 43.13, lon: 131.9 },
  ],
  "Turkey": [
    { name: "Ankara", lat: 39.92, lon: 32.85 },
    { name: "Istanbul", lat: 41.01, lon: 28.95 },
    { name: "Izmir", lat: 38.42, lon: 27.13 },
    { name: "Antalya", lat: 36.9, lon: 30.71 },
    { name: "Cappadocia", lat: 38.64, lon: 34.83 },
  ],
  "Croatia": [
    { name: "Zagreb", lat: 45.81, lon: 15.98 },
    { name: "Split", lat: 43.51, lon: 16.44 },
    { name: "Dubrovnik", lat: 42.65, lon: 18.09 },
  ],
  "Bulgaria": [
    { name: "Sofia", lat: 42.7, lon: 23.32 },
    { name: "Plovdiv", lat: 42.15, lon: 24.75 },
    { name: "Varna", lat: 43.22, lon: 27.91 },
  ],
  "Slovenia": [
    { name: "Ljubljana", lat: 46.05, lon: 14.51 },
    { name: "Maribor", lat: 46.56, lon: 15.65 },
  ],
  "Slovakia": [
    { name: "Bratislava", lat: 48.15, lon: 17.11 },
    { name: "Košice", lat: 48.72, lon: 21.26 },
  ],
  "Serbia": [
    { name: "Belgrade", lat: 44.82, lon: 20.46 },
    { name: "Novi Sad", lat: 45.26, lon: 19.83 },
  ],
  "Bosnia and Herzegovina": [
    { name: "Sarajevo", lat: 43.85, lon: 18.38 },
  ],
  "North Macedonia": [
    { name: "Skopje", lat: 41.99, lon: 21.43 },
  ],
  "Albania": [
    { name: "Tirana", lat: 41.33, lon: 19.83 },
  ],
  "Montenegro": [
    { name: "Podgorica", lat: 42.44, lon: 19.26 },
    { name: "Kotor", lat: 42.42, lon: 18.77 },
  ],
  "Estonia": [
    { name: "Tallinn", lat: 59.44, lon: 24.75 },
    { name: "Tartu", lat: 58.38, lon: 26.72 },
  ],
  "Latvia": [
    { name: "Riga", lat: 56.95, lon: 24.11 },
  ],
  "Lithuania": [
    { name: "Vilnius", lat: 54.69, lon: 25.28 },
    { name: "Kaunas", lat: 54.9, lon: 23.9 },
  ],
  "Iceland": [
    { name: "Reykjavík", lat: 64.14, lon: -21.9 },
    { name: "Akureyri", lat: 65.68, lon: -18.09 },
  ],
  "Luxembourg": [
    { name: "Luxembourg City", lat: 49.61, lon: 6.13 },
  ],
  "Malta": [
    { name: "Valletta", lat: 35.9, lon: 14.51 },
  ],
  "Cyprus": [
    { name: "Nicosia", lat: 35.17, lon: 33.37 },
    { name: "Limassol", lat: 34.69, lon: 33.04 },
  ],
  "Japan": [
    { name: "Tokyo", lat: 35.69, lon: 139.69 },
    { name: "Osaka", lat: 34.69, lon: 135.5 },
    { name: "Kyoto", lat: 35.01, lon: 135.77 },
    { name: "Hiroshima", lat: 34.39, lon: 132.45 },
    { name: "Sapporo", lat: 43.06, lon: 141.35 },
    { name: "Nagoya", lat: 35.18, lon: 136.9 },
    { name: "Fukuoka", lat: 33.59, lon: 130.41 },
  ],
  "South Korea": [
    { name: "Seoul", lat: 37.57, lon: 126.98 },
    { name: "Busan", lat: 35.18, lon: 129.08 },
    { name: "Jeju", lat: 33.5, lon: 126.53 },
    { name: "Incheon", lat: 37.46, lon: 126.7 },
  ],
  "China": [
    { name: "Beijing", lat: 39.91, lon: 116.4 },
    { name: "Shanghai", lat: 31.23, lon: 121.47 },
    { name: "Guangzhou", lat: 23.13, lon: 113.26 },
    { name: "Chengdu", lat: 30.66, lon: 104.07 },
    { name: "Xi'an", lat: 34.27, lon: 108.95 },
    { name: "Shenzhen", lat: 22.54, lon: 114.06 },
    { name: "Hong Kong", lat: 22.32, lon: 114.17 },
  ],
  "India": [
    { name: "New Delhi", lat: 28.64, lon: 77.22 },
    { name: "Mumbai", lat: 19.08, lon: 72.88 },
    { name: "Bangalore", lat: 12.97, lon: 77.59 },
    { name: "Kolkata", lat: 22.57, lon: 88.36 },
    { name: "Chennai", lat: 13.08, lon: 80.27 },
    { name: "Hyderabad", lat: 17.38, lon: 78.49 },
    { name: "Jaipur", lat: 26.92, lon: 75.82 },
    { name: "Agra", lat: 27.18, lon: 78.01 },
    { name: "Goa", lat: 15.3, lon: 74.08 },
  ],
  "Thailand": [
    { name: "Bangkok", lat: 13.75, lon: 100.5 },
    { name: "Chiang Mai", lat: 18.79, lon: 98.98 },
    { name: "Phuket", lat: 7.89, lon: 98.4 },
    { name: "Pattaya", lat: 12.93, lon: 100.88 },
  ],
  "Vietnam": [
    { name: "Hanoi", lat: 21.02, lon: 105.84 },
    { name: "Ho Chi Minh City", lat: 10.82, lon: 106.63 },
    { name: "Da Nang", lat: 16.07, lon: 108.22 },
    { name: "Hội An", lat: 15.88, lon: 108.34 },
  ],
  "Indonesia": [
    { name: "Jakarta", lat: -6.21, lon: 106.85 },
    { name: "Bali", lat: -8.34, lon: 115.09 },
    { name: "Surabaya", lat: -7.25, lon: 112.75 },
    { name: "Yogyakarta", lat: -7.8, lon: 110.37 },
  ],
  "Philippines": [
    { name: "Manila", lat: 14.6, lon: 120.98 },
    { name: "Cebu City", lat: 10.32, lon: 123.9 },
    { name: "Davao", lat: 7.07, lon: 125.61 },
  ],
  "Malaysia": [
    { name: "Kuala Lumpur", lat: 3.14, lon: 101.69 },
    { name: "Georgetown", lat: 5.41, lon: 100.33 },
    { name: "Johor Bahru", lat: 1.49, lon: 103.74 },
  ],
  "Singapore": [
    { name: "Singapore", lat: 1.35, lon: 103.82 },
  ],
  "Myanmar": [
    { name: "Naypyidaw", lat: 19.74, lon: 96.12 },
    { name: "Yangon", lat: 16.87, lon: 96.14 },
  ],
  "Cambodia": [
    { name: "Phnom Penh", lat: 11.56, lon: 104.93 },
    { name: "Siem Reap", lat: 13.36, lon: 103.86 },
  ],
  "Nepal": [
    { name: "Kathmandu", lat: 27.71, lon: 85.32 },
  ],
  "Sri Lanka": [
    { name: "Sri Jayawardenepura Kotte", lat: 6.89, lon: 79.92 },
    { name: "Colombo", lat: 6.93, lon: 79.85 },
    { name: "Kandy", lat: 7.29, lon: 80.64 },
  ],
  "Pakistan": [
    { name: "Islamabad", lat: 33.72, lon: 73.06 },
    { name: "Karachi", lat: 24.86, lon: 67.01 },
    { name: "Lahore", lat: 31.56, lon: 74.35 },
  ],
  "Bangladesh": [
    { name: "Dhaka", lat: 23.81, lon: 90.41 },
    { name: "Chittagong", lat: 22.34, lon: 91.82 },
  ],
  "Australia": [
    { name: "Canberra", lat: -35.28, lon: 149.13 },
    { name: "Sydney", lat: -33.87, lon: 151.21 },
    { name: "Melbourne", lat: -37.81, lon: 144.96 },
    { name: "Brisbane", lat: -27.47, lon: 153.03 },
    { name: "Perth", lat: -31.95, lon: 115.86 },
    { name: "Adelaide", lat: -34.93, lon: 138.6 },
    { name: "Gold Coast", lat: -28.01, lon: 153.43 },
    { name: "Cairns", lat: -16.92, lon: 145.77 },
  ],
  "New Zealand": [
    { name: "Wellington", lat: -41.29, lon: 174.78 },
    { name: "Auckland", lat: -36.85, lon: 174.76 },
    { name: "Queenstown", lat: -45.03, lon: 168.66 },
    { name: "Christchurch", lat: -43.53, lon: 172.64 },
  ],
  "South Africa": [
    { name: "Pretoria", lat: -25.74, lon: 28.19 },
    { name: "Cape Town", lat: -33.93, lon: 18.42 },
    { name: "Johannesburg", lat: -26.2, lon: 28.04 },
    { name: "Durban", lat: -29.86, lon: 31.02 },
    { name: "Port Elizabeth", lat: -33.96, lon: 25.62 },
  ],
  "Egypt": [
    { name: "Cairo", lat: 30.06, lon: 31.25 },
    { name: "Alexandria", lat: 31.2, lon: 29.92 },
    { name: "Luxor", lat: 25.69, lon: 32.64 },
    { name: "Hurghada", lat: 27.26, lon: 33.81 },
    { name: "Sharm el-Sheikh", lat: 27.91, lon: 34.33 },
  ],
  "Morocco": [
    { name: "Rabat", lat: 34.01, lon: -6.83 },
    { name: "Casablanca", lat: 33.59, lon: -7.62 },
    { name: "Marrakesh", lat: 31.63, lon: -8.01 },
    { name: "Fez", lat: 34.03, lon: -5.0 },
  ],
  "Kenya": [
    { name: "Nairobi", lat: -1.28, lon: 36.82 },
    { name: "Mombasa", lat: -4.05, lon: 39.67 },
  ],
  "Nigeria": [
    { name: "Abuja", lat: 9.06, lon: 7.5 },
    { name: "Lagos", lat: 6.45, lon: 3.4 },
    { name: "Kano", lat: 12.0, lon: 8.52 },
  ],
  "Ghana": [
    { name: "Accra", lat: 5.56, lon: -0.2 },
    { name: "Kumasi", lat: 6.7, lon: -1.63 },
  ],
  "Ethiopia": [
    { name: "Addis Ababa", lat: 9.03, lon: 38.74 },
  ],
  "Tanzania": [
    { name: "Dodoma", lat: -6.17, lon: 35.74 },
    { name: "Dar es Salaam", lat: -6.8, lon: 39.28 },
    { name: "Zanzibar City", lat: -6.17, lon: 39.19 },
  ],
  "Uganda": [
    { name: "Kampala", lat: 0.32, lon: 32.58 },
  ],
  "Rwanda": [
    { name: "Kigali", lat: -1.94, lon: 30.06 },
  ],
  "Senegal": [
    { name: "Dakar", lat: 14.69, lon: -17.44 },
  ],
  "Cameroon": [
    { name: "Yaoundé", lat: 3.87, lon: 11.52 },
    { name: "Douala", lat: 4.05, lon: 9.7 },
  ],
  "Tunisia": [
    { name: "Tunis", lat: 36.82, lon: 10.18 },
  ],
  "Algeria": [
    { name: "Algiers", lat: 36.74, lon: 3.06 },
  ],
  "Israel": [
    { name: "Jerusalem", lat: 31.77, lon: 35.22 },
    { name: "Tel Aviv", lat: 32.08, lon: 34.78 },
    { name: "Haifa", lat: 32.82, lon: 34.99 },
  ],
  "United Arab Emirates": [
    { name: "Abu Dhabi", lat: 24.45, lon: 54.4 },
    { name: "Dubai", lat: 25.2, lon: 55.27 },
    { name: "Sharjah", lat: 25.36, lon: 55.39 },
  ],
  "Saudi Arabia": [
    { name: "Riyadh", lat: 24.69, lon: 46.72 },
    { name: "Jeddah", lat: 21.49, lon: 39.19 },
    { name: "Mecca", lat: 21.39, lon: 39.86 },
  ],
  "Jordan": [
    { name: "Amman", lat: 31.95, lon: 35.93 },
    { name: "Petra", lat: 30.33, lon: 35.44 },
  ],
  "Lebanon": [
    { name: "Beirut", lat: 33.89, lon: 35.5 },
  ],
  "Qatar": [
    { name: "Doha", lat: 25.29, lon: 51.53 },
  ],
  "Kuwait": [
    { name: "Kuwait City", lat: 29.37, lon: 47.98 },
  ],
  "Bahrain": [
    { name: "Manama", lat: 26.22, lon: 50.59 },
  ],
  "Oman": [
    { name: "Muscat", lat: 23.61, lon: 58.59 },
  ],
  "Iran": [
    { name: "Tehran", lat: 35.69, lon: 51.39 },
    { name: "Isfahan", lat: 32.66, lon: 51.68 },
    { name: "Shiraz", lat: 29.61, lon: 52.53 },
  ],
  "Iraq": [
    { name: "Baghdad", lat: 33.34, lon: 44.4 },
  ],
  "Georgia": [
    { name: "Tbilisi", lat: 41.69, lon: 44.83 },
    { name: "Batumi", lat: 41.64, lon: 41.64 },
  ],
  "Armenia": [
    { name: "Yerevan", lat: 40.18, lon: 44.51 },
  ],
  "Azerbaijan": [
    { name: "Baku", lat: 40.41, lon: 49.87 },
  ],
  "Kazakhstan": [
    { name: "Astana", lat: 51.18, lon: 71.45 },
    { name: "Almaty", lat: 43.27, lon: 76.95 },
  ],
  "Uzbekistan": [
    { name: "Tashkent", lat: 41.3, lon: 69.24 },
    { name: "Samarkand", lat: 39.66, lon: 66.96 },
  ],
  "Mongolia": [
    { name: "Ulaanbaatar", lat: 47.92, lon: 106.92 },
  ],
  "Cuba": [
    { name: "Havana", lat: 23.13, lon: -82.38 },
    { name: "Trinidad", lat: 21.8, lon: -79.98 },
  ],
  "Jamaica": [
    { name: "Kingston", lat: 17.99, lon: -76.79 },
    { name: "Montego Bay", lat: 18.47, lon: -77.92 },
  ],
  "Dominican Republic": [
    { name: "Santo Domingo", lat: 18.48, lon: -69.93 },
    { name: "Punta Cana", lat: 18.58, lon: -68.4 },
  ],
  "Costa Rica": [
    { name: "San José", lat: 9.93, lon: -84.08 },
  ],
  "Panama": [
    { name: "Panama City", lat: 8.99, lon: -79.52 },
  ],
  "Guatemala": [
    { name: "Guatemala City", lat: 14.63, lon: -90.52 },
  ],
  "Beroemde Bezienswaardigheden": [
    { name: "Eiffeltoren (Frankrijk)", lat: 48.8584, lon: 2.2945 },
    { name: "Taj Mahal (India)", lat: 27.1751, lon: 78.0421 },
    { name: "Vrijheidsbeeld (VS)", lat: 40.6892, lon: -74.0445 },
    { name: "Colosseum (Italië)", lat: 41.8902, lon: 12.4922 },
    { name: "Machu Picchu (Peru)", lat: -13.1631, lon: -72.5450 },
    { name: "Sydney Opera House (Australië)", lat: -33.8568, lon: 151.2153 },
    { name: "Grote Muur van China", lat: 40.4319, lon: 116.5704 },
    { name: "Piramide van Cheops (Egypte)", lat: 29.9792, lon: 31.1342 },
    { name: "Christus de Verlosser (Brazilië)", lat: -22.9519, lon: -43.2105 },
    { name: "Stonehenge (VK)", lat: 51.1789, lon: -1.8262 },
    { name: "Burj Khalifa (VAE)", lat: 25.1972, lon: 55.2744 },
    { name: "Mount Rushmore (VS)", lat: 43.8791, lon: -103.4591 },
    { name: "Chichén Itzá (Mexico)", lat: 20.6843, lon: -88.5678 },
    { name: "Acropolis (Griekenland)", lat: 37.9715, lon: 23.7257 },
    { name: "Golden Gate Bridge (VS)", lat: 37.8199, lon: -122.4783 },
    { name: "Toren van Pisa (Italië)", lat: 43.7230, lon: 10.3966 },
    { name: "Angkor Wat (Cambodja)", lat: 13.4125, lon: 103.8670 },
    { name: "Big Ben (VK)", lat: 51.5007, lon: -0.1246 },
    { name: "Sagrada Familia (Spanje)", lat: 41.4036, lon: 2.1744 }
  ],
};

// ---- Continent groupings ----
export const CONTINENT_MAP = {
  europe: [
    "United Kingdom","France","Germany","Spain","Italy","Netherlands","Belgium",
    "Switzerland","Austria","Portugal","Poland","Czech Republic","Sweden","Norway",
    "Denmark","Finland","Ireland","Greece","Hungary","Romania","Ukraine","Russia",
    "Turkey","Croatia","Bulgaria","Slovenia","Slovakia","Serbia","Bosnia and Herzegovina",
    "North Macedonia","Albania","Montenegro","Estonia","Latvia","Lithuania","Iceland",
    "Luxembourg","Malta","Cyprus",
  ],
  americas: [
    "United States of America","Canada","Mexico","Brazil","Argentina","Chile",
    "Colombia","Peru","Venezuela","Bolivia","Ecuador","Uruguay","Paraguay",
    "Cuba","Jamaica","Dominican Republic","Costa Rica","Panama","Guatemala",
  ],
  asia: [
    "Japan","South Korea","China","India","Thailand","Vietnam","Indonesia",
    "Philippines","Malaysia","Singapore","Myanmar","Cambodia","Nepal","Sri Lanka",
    "Pakistan","Bangladesh","Israel","United Arab Emirates","Saudi Arabia","Jordan",
    "Lebanon","Qatar","Kuwait","Bahrain","Oman","Iran","Iraq","Georgia","Armenia",
    "Azerbaijan","Kazakhstan","Uzbekistan","Mongolia","Turkey",
  ],
  africa: [
    "South Africa","Egypt","Morocco","Kenya","Nigeria","Ghana","Ethiopia",
    "Tanzania","Uganda","Rwanda","Senegal","Cameroon","Tunisia","Algeria",
  ],
  oceania: [
    "Australia","New Zealand",
  ],
};

// ---- Location sets ----
// Each set defines which countries are eligible and optionally restricts to only the capital (index 0).
export const LOCATION_SETS = {
  world: {
    label: "Hele wereld",
    countries: Object.keys(GEO_POINTS),
    onlyCapital: false,
  },
  capitals: {
    label: "Hoofdsteden",
    countries: Object.keys(GEO_POINTS),
    onlyCapital: true,
  },
  bigcities: {
    label: "Grote steden",
    // Only countries with more than 1 point
    countries: Object.keys(GEO_POINTS).filter((c) => GEO_POINTS[c].length > 1),
    onlyCapital: false,
  },
  europe: {
    label: "Europa",
    countries: CONTINENT_MAP.europe,
    onlyCapital: false,
  },
  americas: {
    label: "Amerika's",
    countries: CONTINENT_MAP.americas,
    onlyCapital: false,
  },
  asia: {
    label: "Azië",
    countries: CONTINENT_MAP.asia,
    onlyCapital: false,
  },
  africa: {
    label: "Afrika",
    countries: CONTINENT_MAP.africa,
    onlyCapital: false,
  },
  oceania: {
    label: "Oceanië",
    countries: CONTINENT_MAP.oceania,
    onlyCapital: false,
  },
  netherlands: {
    label: "Nederland",
    countries: ["Netherlands"],
    onlyCapital: false,
  },
  landmarks: {
    label: "Beroemde bezienswaardigheden",
    countries: ["Beroemde Bezienswaardigheden"],
    onlyCapital: false,
  }
};