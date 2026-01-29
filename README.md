# BLANK LOAD BALANCER 

## Description

Loadbalance the traffic between multiple endpoints using cloudflare workers. 

## Usage 

```ts 

import { Endpoint, LoadBalancer } from "@blank-utils/lb";

const lb = new LoadBalancer({
  endpoints: [
    new Endpoint("https://api1.example.com"),
    new Endpoint("https://api2.example.com"),
    new Endpoint("https://api3.example.com"),
  ],
});

export default {
  async fetchAPI(
    request: Request<unknown, IncomingRequestCfProperties>,
  ): Promise<Response> {
    return lb.handleRequest(request);
  },
};
```
